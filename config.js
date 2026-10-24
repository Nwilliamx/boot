require('dotenv').config();

// Edite este arquivo para adaptar o bot ao seu negócio.
// Evite colocar chaves de API, senhas ou outros segredos aqui.

const businessName = process.env.BUSINESS_NAME || 'Minha Empresa';

module.exports = {
    business: {
        name: businessName,
        description: 'Atendimento automático pelo WhatsApp.'
    },

    // O pagamento é opcional. Para ativar a NexusPag, configure o .env.
    payment: {
        enabled: process.env.PAYMENTS_ENABLED === 'true',
        provider: 'nexuspag',
        expirationSeconds: Number(process.env.PIX_EXPIRATION_SECONDS || 1800)
    },

    // Palavras e frases que acionam cada área do bot.
    commands: {
        menu: ['menu', 'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'início', 'inicio'],
        buy: ['comprar', '!comprar', 'produtos', 'catálogo', 'catalogo'],
        cancel: ['cancelar', '!cancelar'],
        support: ['suporte', 'ajuda', 'atendente', 'falar com alguém', 'falar com alguem'],
        tutorial: ['tutorial', 'instalar', 'como usar']
    },

    // Cadastre produtos ou serviços. O exemplo é apenas demonstrativo.
    // aliases são alternativas que o cliente pode digitar para selecionar o item.
    // fulfillment.type aceita: 'stock', 'message' ou 'manual'.
    // Para 'stock', crie o arquivo definido em stockFile, com um item por linha.
    products: [
        {
            id: 'produto_demo',
            name: 'Produto de exemplo',
            aliases: ['1', 'produto', 'produto de exemplo'],
            price: 19.90,
            description: 'Descrição do produto ou serviço. Edite esta frase.',
            durationDays: null,
            fulfillment: {
                type: 'stock',
                stockFile: 'produto-demo.txt',
                label: 'Seu código ou acesso',
                message: 'Obrigado pela compra! Guarde o item abaixo em local seguro.'
            }
        }
    ],

    links: {
        tutorial: '',
        support: '',
        terms: ''
    },

    messages: {
        support: 'Para agilizar o atendimento, informe seu nome e descreva o que aconteceu. Não envie senhas ou dados bancários.',
        paymentDisabled: 'A compra automática ainda não está configurada neste bot. Entre em contato com o atendimento para concluir seu pedido.',
        manualDelivery: 'Seu pagamento foi confirmado. A entrega deste pedido precisa ser concluída manualmente pela equipe. Informe o número do pedido ao atendimento.',
        afterPayment: '✅ Pagamento confirmado com sucesso!',
        pendingPayment: '⏳ Este pedido ainda está aguardando a confirmação do pagamento. Enviaremos uma mensagem quando houver atualização.',
        deliveryFooter: 'Em caso de dúvida, responda a esta conversa para falar com o atendimento.'
    }
};
