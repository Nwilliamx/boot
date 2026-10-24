require('dotenv').config();

const crypto = require('crypto');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const config = require('./config');
const pedidosStore = require('./lib/orders');
const estoque = require('./lib/stock');
const { gerarPix } = require('./lib/nexuspag');
const { iniciarWebhook } = require('./lib/webhook');

const sessoes = new Map();

function validarConfiguracao() {
    if (!config.business.name || config.business.name === 'Minha Empresa') {
        console.log('ℹ️ Dica: personalize BUSINESS_NAME no .env e as mensagens em config.js.');
    }

    if (!config.payment.enabled) {
        console.log('ℹ️ Pagamentos automáticos desativados. O bot iniciará sem NexusPag.');
        return;
    }

    const obrigatorias = [
        ['NEXUSPAG_API_KEY', process.env.NEXUSPAG_API_KEY],
        ['WEBHOOK_SECRET', process.env.WEBHOOK_SECRET],
        ['WEBHOOK_PUBLIC_URL', process.env.WEBHOOK_PUBLIC_URL]
    ];
    const faltantes = obrigatorias.filter(([, valor]) => !valor).map(([nome]) => nome);

    if (faltantes.length) {
        console.error(`❌ Configure no .env: ${faltantes.join(', ')}`);
        process.exit(1);
    }
}

function normalizar(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function dinheiroBR(valor) {
    return Number(valor).toFixed(2).replace('.', ',');
}

function formatarDataBR(data) {
    return new Date(data).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function correspondeComando(texto, aliases = []) {
    const mensagem = normalizar(texto);
    return aliases.some((alias) => normalizar(alias) === mensagem);
}

function localizarProduto(texto) {
    const valor = normalizar(texto);
    return config.products.find((produto, indice) => {
        const opcoes = [String(indice + 1), produto.id, produto.name, ...(produto.aliases || [])];
        return opcoes.some((opcao) => normalizar(opcao) === valor);
    }) || null;
}

function montarCatalogo() {
    if (!config.products.length) {
        return 'No momento, não há produtos cadastrados. Edite o catálogo no arquivo config.js.';
    }

    const itens = config.products.map((produto, indice) => {
        const descricao = produto.description ? `\n   ${produto.description}` : '';
        return `${indice + 1}. *${produto.name}* — R$ ${dinheiroBR(produto.price)}${descricao}`;
    });

    return `🛍️ *Catálogo — ${config.business.name}*\n\n${itens.join('\n\n')}\n\nDigite o número ou o nome do item desejado.`;
}

function montarMenu() {
    const descricao = config.business.description ? `${config.business.description}\n\n` : '';
    return `👋 Olá! Boas-vindas à *${config.business.name}*.\n\n` +
        descricao +
        'Como podemos ajudar?\n\n' +
        '🛍️ *COMPRAR* — Ver produtos/serviços\n' +
        '🛠️ *SUPORTE* — Falar com o atendimento\n' +
        (config.links.tutorial ? '📘 *TUTORIAL* — Ver instruções\n' : '') +
        '\nDigite uma das opções acima para continuar.';
}

function montarMensagemEntrega(pedido, produto, item) {
    const fulfillment = produto.fulfillment || {};
    const mensagemBase = fulfillment.message || `✅ Aqui está sua entrega: {item}`;
    return mensagemBase
        .replaceAll('{item}', item || '')
        .replaceAll('{produto}', produto.name)
        .replaceAll('{pedido}', pedido.external_id)
        .replaceAll('{empresa}', config.business.name);
}

async function enviarPix(msg, respostaApi, valor) {
    const transacao = respostaApi?.transaction || respostaApi?.data?.transaction || respostaApi?.data || respostaApi;
    const codigoPix = transacao?.pix_copia_cola || transacao?.copy_paste || transacao?.brcode || transacao?.pixCopyPaste;
    const qrBase64 = transacao?.qr_code_base64 || transacao?.qrCodeBase64;

    if (qrBase64) {
        try {
            const encontrado = String(qrBase64).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
            const mime = encontrado ? encontrado[1] : 'image/png';
            const conteudo = encontrado ? encontrado[2] : String(qrBase64).replace(/\s/g, '');
            const media = new MessageMedia(mime, conteudo, 'pix.png');
            await msg.reply(media, undefined, {
                caption: `💳 *Pagamento PIX*\n\n💰 Valor: R$ ${dinheiroBR(valor)}\n\nEscaneie o QR Code para pagar.`
            });
        } catch (error) {
            console.warn('Não foi possível enviar a imagem do QR Code:', error.message);
        }
    }

    if (codigoPix) {
        await msg.reply(`\`${codigoPix}\``);
        await msg.reply('📋 Copie o código acima e cole no aplicativo do seu banco. Assim que o pagamento for confirmado, enviaremos uma mensagem por aqui.');
    } else {
        await msg.reply('⚠️ A cobrança foi criada, mas a resposta não trouxe o código PIX esperado. Entre em contato com o atendimento e informe o número do pedido.');
    }
}

async function entregarPedido(pedido, pedidos) {
    if (['delivered', 'manual_pending', 'delivery_error', 'processing'].includes(pedido.status_entrega)) {
        return;
    }

    const produto = config.products.find((item) => item.id === pedido.produto_id);
    if (!produto) {
        pedido.status_entrega = 'manual_pending';
        pedido.erro_entrega = 'Produto não encontrado na configuração atual.';
        pedidosStore.salvarPedidos(pedidos);
        return;
    }

    pedido.status_entrega = 'processing';
    pedido.tentativa_entrega_em = new Date().toISOString();
    pedidosStore.salvarPedidos(pedidos);

    try {
        const tipo = produto.fulfillment?.type || 'manual';
        let mensagemEntrega;

        if (tipo === 'stock') {
            const nomeArquivo = produto.fulfillment?.stockFile;
            const item = estoque.retirarItemDoEstoque(nomeArquivo);

            if (!item) {
                pedido.status_entrega = 'manual_pending';
                pedido.erro_entrega = 'Estoque vazio.';
                pedidosStore.salvarPedidos(pedidos);
                await client.sendMessage(
                    pedido.cliente_whatsapp,
                    `${config.messages.manualDelivery}\n\nPedido: ${pedido.external_id}\nProduto: ${produto.name}`
                );
                console.error(`Estoque vazio para o produto ${produto.id}; pedido ${pedido.external_id} requer entrega manual.`);
                return;
            }

            // Guarda o item reservado no pedido antes de tentar enviar. Se o envio falhar,
            // ele não é devolvido automaticamente para evitar entrega duplicada a outra pessoa.
            pedido.item_entrega = item;
            pedidosStore.salvarPedidos(pedidos);
            mensagemEntrega = montarMensagemEntrega(pedido, produto, item);
        } else if (tipo === 'message') {
            mensagemEntrega = montarMensagemEntrega(pedido, produto, '');
        } else {
            pedido.status_entrega = 'manual_pending';
            pedidosStore.salvarPedidos(pedidos);
            await client.sendMessage(
                pedido.cliente_whatsapp,
                `${config.messages.manualDelivery}\n\nPedido: ${pedido.external_id}\nProduto/serviço: ${produto.name}`
            );
            return;
        }

        const complemento = config.messages.deliveryFooter ? `\n\n${config.messages.deliveryFooter}` : '';
        await client.sendMessage(pedido.cliente_whatsapp, `${mensagemEntrega}${complemento}`);
        pedido.status_entrega = 'delivered';
        pedido.entregue_em = new Date().toISOString();
        pedidosStore.salvarPedidos(pedidos);
        console.log(`✅ Entrega concluída para o pedido ${pedido.external_id}.`);
    } catch (error) {
        pedido.status_entrega = 'delivery_error';
        pedido.erro_entrega = error.message;
        pedidosStore.salvarPedidos(pedidos);
        console.error(`Falha ao enviar a entrega do pedido ${pedido.external_id}: ${error.message}`);
    }
}

async function processarPagamentoConfirmado(payload) {
    const externalIdEncontrado = encontrarValor(payload, ['external_id', 'externalId']);
    const transactionIdEncontrado = encontrarValor(payload, [
        'transaction_id', 'transactionId', 'payment_id', 'paymentId', 'id'
    ]);
    const externalId = externalIdEncontrado == null ? null : String(externalIdEncontrado);
    const transactionId = transactionIdEncontrado == null ? null : String(transactionIdEncontrado);

    if (!externalId && !transactionId) {
        console.warn('Webhook de pagamento confirmado sem identificador reconhecido.');
        return { atualizado: false, motivo: 'identificador_nao_encontrado' };
    }

    const pedidos = pedidosStore.carregarPedidos();
    const pedido = pedidos.find((item) => {
        const bateExternal = externalId && (String(item.external_id) === externalId || String(item.id) === externalId);
        const bateTransaction = transactionId && item.transaction_id != null && String(item.transaction_id) === transactionId;
        return Boolean(bateExternal || bateTransaction);
    });

    if (!pedido) {
        console.warn('Webhook confirmado, mas o pedido correspondente não foi encontrado.', { externalId, transactionId });
        return { atualizado: false, motivo: 'pedido_nao_encontrado' };
    }

    if (pedido.status_pagamento === 'paid') {
        // Um webhook repetido não deve gerar uma segunda entrega.
        if (pedido.status_entrega === 'pending') {
            await entregarPedido(pedido, pedidos);
        }
        return { atualizado: false, motivo: 'ja_confirmado' };
    }

    pedido.status_pagamento = 'paid';
    pedido.pagamento_confirmado_em = new Date().toISOString();
    if (transactionId && !pedido.transaction_id) pedido.transaction_id = transactionId;

    const agora = new Date();
    pedido.data_inicio = agora.toISOString();
    if (Number.isFinite(Number(pedido.duracao_dias)) && Number(pedido.duracao_dias) > 0) {
        pedido.data_termino = new Date(agora.getTime() + Number(pedido.duracao_dias) * 86400000).toISOString();
    }
    pedido.status_entrega = pedido.status_entrega || 'pending';
    pedidosStore.salvarPedidos(pedidos);

    const sessao = sessoes.get(pedido.cliente_whatsapp);
    if (sessao) {
        sessao.etapa = 'pagamento_confirmado';
        sessoes.set(pedido.cliente_whatsapp, sessao);
    }

    let confirmacao = `${config.messages.afterPayment}\n\n📦 Pedido: ${pedido.external_id}\n🛍️ Item: ${pedido.produto_nome}`;
    if (pedido.data_inicio) confirmacao += `\n📅 Início: ${formatarDataBR(pedido.data_inicio)}`;
    if (pedido.data_termino) confirmacao += `\n📅 Término: ${formatarDataBR(pedido.data_termino)}`;

    try {
        await client.sendMessage(pedido.cliente_whatsapp, confirmacao);
    } catch (error) {
        console.error(`Pagamento foi salvo, mas não foi possível enviar a confirmação do pedido ${pedido.external_id}: ${error.message}`);
    }

    await entregarPedido(pedido, pedidos);
    console.log(`✅ Pagamento confirmado para o pedido ${pedido.external_id}.`);
    return { atualizado: true, motivo: 'pagamento_confirmado' };
}

function encontrarValor(objeto, chavesProcuradas) {
    if (!objeto || typeof objeto !== 'object') return null;

    // Procura cada nome de chave em todo o payload antes de tentar a próxima.
    // Assim, um "id" genérico na raiz não ganha prioridade sobre transaction_id aninhado.
    for (const chaveProcurada of chavesProcuradas) {
        const encontrado = encontrarChaveRecursiva(objeto, chaveProcurada);
        if (encontrado !== null && encontrado !== undefined) return encontrado;
    }

    return null;
}

function encontrarChaveRecursiva(objeto, chaveProcurada) {
    if (!objeto || typeof objeto !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(objeto, chaveProcurada)) {
        return objeto[chaveProcurada];
    }

    for (const valor of Object.values(objeto)) {
        if (valor && typeof valor === 'object') {
            const encontrado = encontrarChaveRecursiva(valor, chaveProcurada);
            if (encontrado !== null && encontrado !== undefined) return encontrado;
        }
    }
    return null;
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: process.env.WHATSAPP_SESSION_NAME || 'whatsapp-bot-template'
    })
});

client.on('qr', (qr) => {
    console.log('Escaneie o QR Code abaixo usando o WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log(`✅ ${config.business.name} conectado ao WhatsApp.`);
});

client.on('auth_failure', (mensagem) => {
    console.error('Falha na autenticação do WhatsApp:', mensagem);
});

client.on('disconnected', (motivo) => {
    console.warn('WhatsApp desconectado:', motivo);
});

client.on('message', async (msg) => {
    // Não responde a grupos, mensagens do próprio bot ou status.
    if (msg.fromMe || msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;

    const textoOriginal = (msg.body || '').trim();
    const texto = normalizar(textoOriginal);
    const chatId = msg.from;

    if (!texto) return;
    console.log(`📩 Mensagem recebida de ${chatId}: ${textoOriginal.slice(0, 120)}`);

    try {
        if (correspondeComando(texto, config.commands.cancel)) {
            sessoes.delete(chatId);
            await msg.reply('A operação atual foi cancelada. Digite *menu* para ver as opções.');
            return;
        }

        if (correspondeComando(texto, config.commands.support)) {
            const link = config.links.support ? `\n\n🔗 Atendimento: ${config.links.support}` : '';
            await msg.reply(`🛠️ *Suporte — ${config.business.name}*\n\n${config.messages.support}${link}`);
            return;
        }

        if (correspondeComando(texto, config.commands.tutorial) && config.links.tutorial) {
            await msg.reply(`📘 Instruções e tutorial:\n${config.links.tutorial}`);
            return;
        }

        if (correspondeComando(texto, config.commands.menu)) {
            sessoes.delete(chatId);
            await msg.reply(montarMenu());
            return;
        }

        if (correspondeComando(texto, config.commands.buy)) {
            if (!config.payment.enabled) {
                const aviso = config.messages.paymentDisabled;
                await msg.reply(`${montarCatalogo()}\n\n${aviso}`);
                return;
            }

            sessoes.set(chatId, { etapa: 'escolhendo_produto' });
            await msg.reply(montarCatalogo());
            return;
        }

        const sessao = sessoes.get(chatId);
        if (!sessao) return;

        if (sessao.etapa === 'escolhendo_produto') {
            const produto = localizarProduto(texto);
            if (!produto) {
                await msg.reply('Não reconheci esse item. Digite o número ou o nome de um produto do catálogo, ou *cancelar* para sair.');
                return;
            }

            sessao.produto = produto;
            sessao.etapa = 'confirmando_compra';
            sessoes.set(chatId, sessao);

            await msg.reply(
                `🛍️ *${produto.name}*\n` +
                (produto.description ? `${produto.description}\n` : '') +
                `\n💰 Valor: R$ ${dinheiroBR(produto.price)}\n\n` +
                'Deseja gerar o pagamento PIX agora? Digite *SIM* para continuar ou *NÃO* para cancelar.'
            );
            return;
        }

        if (sessao.etapa === 'confirmando_compra') {
            if (['sim', 's', 'confirmar'].includes(texto)) {
                await msg.reply('⏳ Gerando seu pagamento PIX...');

                const externalId = `pedido-${Date.now()}-${crypto.randomUUID()}`;
                const respostaPix = await gerarPix({
                    valor: sessao.produto.price,
                    descricao: `${config.business.name} - ${sessao.produto.name}`,
                    externalId,
                    expirationSeconds: config.payment.expirationSeconds
                });

                const transacao = respostaPix?.transaction || respostaPix?.data?.transaction || respostaPix?.data || respostaPix;
                const transactionId = transacao?.id == null ? null : String(transacao.id);

                const pedido = {
                    id: externalId,
                    external_id: externalId,
                    transaction_id: transactionId,
                    cliente_whatsapp: chatId,
                    nome: msg._data?.notifyName || null,
                    produto_id: sessao.produto.id,
                    produto_nome: sessao.produto.name,
                    valor: Number(sessao.produto.price),
                    duracao_dias: sessao.produto.durationDays || null,
                    status_pagamento: 'pending',
                    status_entrega: 'pending',
                    criado_em: new Date().toISOString()
                };

                pedidosStore.adicionarPedido(pedido);
                sessao.etapa = 'aguardando_pagamento';
                sessao.externalId = externalId;
                sessoes.set(chatId, sessao);

                await enviarPix(msg, respostaPix, sessao.produto.price);
                console.log(`💳 PIX criado para o pedido ${externalId}.`);
                return;
            }

            if (['nao', 'n', 'cancelar'].includes(texto)) {
                sessoes.delete(chatId);
                await msg.reply('Compra cancelada. Quando quiser, digite *comprar* para ver o catálogo.');
                return;
            }

            await msg.reply('Digite *SIM* para gerar o PIX ou *NÃO* para cancelar.');
            return;
        }

        if (sessao.etapa === 'aguardando_pagamento') {
            await msg.reply(config.messages.pendingPayment);
            return;
        }

        if (sessao.etapa === 'pagamento_confirmado') {
            await msg.reply('✅ O pagamento já foi confirmado. Confira as mensagens anteriores para ver os detalhes do pedido e da entrega.');
        }
    } catch (error) {
        console.error('Erro ao processar mensagem:', error.message);
        try {
            await msg.reply('Não foi possível concluir essa solicitação agora. Tente novamente ou digite *suporte* para receber ajuda.');
        } catch (erroResposta) {
            console.error('Também não foi possível enviar a mensagem de erro:', erroResposta.message);
        }
    }
});

validarConfiguracao();
pedidosStore.garantirArquivos();

if (config.payment.enabled) {
    iniciarWebhook(processarPagamentoConfirmado);
}

client.initialize();
