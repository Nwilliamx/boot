const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'pedidos.json');

function garantirArquivos() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(ORDERS_FILE)) {
        fs.writeFileSync(ORDERS_FILE, '[]\n', 'utf8');
    }
}

function carregarPedidos() {
    garantirArquivos();

    try {
        const conteudo = fs.readFileSync(ORDERS_FILE, 'utf8');
        const pedidos = JSON.parse(conteudo);

        if (!Array.isArray(pedidos)) {
            throw new Error('O conteúdo de pedidos.json precisa ser uma lista JSON.');
        }

        return pedidos;
    } catch (error) {
        // Não substitui automaticamente um arquivo corrompido, para evitar perda de pedidos.
        throw new Error(`Não foi possível ler ${ORDERS_FILE}: ${error.message}`);
    }
}

function salvarPedidos(pedidos) {
    garantirArquivos();

    if (!Array.isArray(pedidos)) {
        throw new TypeError('salvarPedidos espera uma lista de pedidos.');
    }

    const temporario = `${ORDERS_FILE}.tmp`;
    fs.writeFileSync(temporario, `${JSON.stringify(pedidos, null, 2)}\n`, 'utf8');
    fs.renameSync(temporario, ORDERS_FILE);
}

function adicionarPedido(pedido) {
    const pedidos = carregarPedidos();
    pedidos.push(pedido);
    salvarPedidos(pedidos);
    return pedido;
}

module.exports = {
    garantirArquivos,
    carregarPedidos,
    salvarPedidos,
    adicionarPedido
};
