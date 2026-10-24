const NEXUSPAG_URL = 'https://nexuspag.com/api/pix/create';

async function gerarPix({ valor, descricao, externalId, expirationSeconds }) {
    const apiKey = process.env.NEXUSPAG_API_KEY;
    const webhookPublicUrl = (process.env.WEBHOOK_PUBLIC_URL || '').replace(/\/$/, '');

    if (!apiKey) {
        throw new Error('NEXUSPAG_API_KEY não está configurada no .env.');
    }
    if (!webhookPublicUrl) {
        throw new Error('WEBHOOK_PUBLIC_URL não está configurada no .env.');
    }

    const response = await fetch(NEXUSPAG_URL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            amount: Number(valor),
            description: descricao,
            external_id: externalId,
            expiration: Number(expirationSeconds || 1800),
            webhook_url: `${webhookPublicUrl}/webhook/nexuspag`
        })
    });

    const corpo = await response.text();
    let dados;

    try {
        dados = corpo ? JSON.parse(corpo) : {};
    } catch {
        throw new Error(`A NexusPag retornou uma resposta que não é JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
        throw new Error(
            dados.message || dados.error || `Falha ao criar PIX (HTTP ${response.status}).`
        );
    }

    return dados;
}

module.exports = { gerarPix };
