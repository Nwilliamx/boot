const crypto = require('crypto');
const express = require('express');

const CAMINHO_WEBHOOK = '/webhook/nexuspag';

function assinaturaValida(corpoBruto, assinaturaRecebida) {
    const segredo = process.env.WEBHOOK_SECRET;
    if (!segredo || !assinaturaRecebida || !Buffer.isBuffer(corpoBruto)) {
        return false;
    }

    const partes = String(assinaturaRecebida)
        .trim()
        .split(',')
        .reduce((resultado, parte) => {
            const separador = parte.indexOf('=');
            if (separador > 0) {
                const chave = parte.slice(0, separador).trim();
                const valor = parte.slice(separador + 1).trim();
                resultado[chave] = valor;
            }
            return resultado;
        }, {});

    const timestamp = partes.t;
    const assinaturaRecebidaHex = partes.v1;
    if (!timestamp || !assinaturaRecebidaHex) return false;

    const assinaturaCalculada = crypto
        .createHmac('sha256', segredo)
        .update(`${timestamp}.${corpoBruto.toString('utf8')}`)
        .digest('hex');

    // timingSafeEqual exige buffers do mesmo tamanho.
    const calculada = Buffer.from(assinaturaCalculada, 'utf8');
    const recebida = Buffer.from(assinaturaRecebidaHex, 'utf8');
    if (calculada.length !== recebida.length) return false;

    return crypto.timingSafeEqual(calculada, recebida);
}

function coletarCamposRelevantes(objeto, chavesProcuradas, encontrados = []) {
    if (!objeto || typeof objeto !== 'object') return encontrados;

    for (const [chave, valor] of Object.entries(objeto)) {
        if (chavesProcuradas.has(chave.toLowerCase()) && (typeof valor === 'string' || typeof valor === 'number')) {
            encontrados.push(String(valor).trim().toLowerCase());
        }
        if (valor && typeof valor === 'object') {
            coletarCamposRelevantes(valor, chavesProcuradas, encontrados);
        }
    }

    return encontrados;
}

function pagamentoEstaConfirmado(payload) {
    // Não marca pedidos como pagos só porque recebeu um webhook válido.
    // Se o provedor usar outro nome/valor para o evento de confirmação,
    // adapte esta lista após conferir o payload oficial da NexusPag.
    const campos = coletarCamposRelevantes(payload, new Set([
        'status',
        'payment_status',
        'transaction_status',
        'event',
        'event_type',
        'type'
    ]));

    const confirmacoes = new Set([
        'paid',
        'approved',
        'confirmed',
        'completed',
        'success',
        'succeeded',
        'payment.paid',
        'payment.approved',
        'payment.confirmed',
        'transaction.paid',
        'transaction.approved',
        'transaction.confirmed',
        'charge.paid'
    ]);

    return campos.some((valor) => {
        if (confirmacoes.has(valor)) return true;
        return /^(payment|transaction|charge)[._](paid|approved|confirmed|completed|succeeded)$/.test(valor);
    });
}

function iniciarWebhook(processarPagamento) {
    const app = express();
    const porta = Number(process.env.WEBHOOK_PORT || 3000);

    app.post(
        CAMINHO_WEBHOOK,
        express.raw({ type: '*/*', limit: '1mb' }),
        async (req, res) => {
            try {
                const assinatura = req.headers['x-webhook-signature'];
                const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

                if (!assinaturaValida(corpo, assinatura)) {
                    console.warn('Webhook NexusPag rejeitado: assinatura inválida.');
                    return res.status(401).json({ success: false, message: 'Assinatura inválida.' });
                }

                let payload;
                try {
                    payload = JSON.parse(corpo.toString('utf8'));
                } catch {
                    return res.status(400).json({ success: false, message: 'JSON inválido.' });
                }

                if (!pagamentoEstaConfirmado(payload)) {
                    console.log('Webhook recebido, mas não indica pagamento confirmado. Evento ignorado.');
                    return res.status(200).json({ success: true, resultado: 'evento_ignorado' });
                }

                const resultado = await processarPagamento(payload);
                return res.status(200).json({
                    success: true,
                    resultado: resultado?.motivo || 'processado'
                });
            } catch (error) {
                console.error('Erro ao processar webhook:', error.message);
                return res.status(500).json({ success: false, message: 'Erro interno.' });
            }
        }
    );

    app.get('/', (_req, res) => {
        res.status(404).json({ success: false, message: 'Rota não encontrada.' });
    });

    const server = app.listen(porta, '127.0.0.1', () => {
        console.log(`Servidor de webhook ativo em http://127.0.0.1:${porta}${CAMINHO_WEBHOOK}`);
    });

    return server;
}

module.exports = {
    iniciarWebhook,
    assinaturaValida,
    pagamentoEstaConfirmado
};
