const fs = require('fs');
const path = require('path');

const STOCK_DIR = path.join(__dirname, '..', 'data', 'estoque');

function resolverArquivoEstoque(nomeArquivo) {
    if (typeof nomeArquivo !== 'string' || !nomeArquivo.trim()) {
        throw new Error('O produto não definiu um arquivo de estoque válido.');
    }

    // Só aceita um nome de arquivo, impedindo caminhos como ../../arquivo.
    if (path.basename(nomeArquivo) !== nomeArquivo || nomeArquivo.includes('..')) {
        throw new Error('O arquivo de estoque deve ser informado apenas pelo nome, sem diretórios.');
    }

    fs.mkdirSync(STOCK_DIR, { recursive: true });
    return path.join(STOCK_DIR, nomeArquivo);
}

function retirarItemDoEstoque(nomeArquivo) {
    const arquivo = resolverArquivoEstoque(nomeArquivo);

    if (!fs.existsSync(arquivo)) {
        fs.writeFileSync(arquivo, '', 'utf8');
    }

    const linhas = fs.readFileSync(arquivo, 'utf8')
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .filter(Boolean);

    if (linhas.length === 0) {
        return null;
    }

    const [item, ...restantes] = linhas;
    fs.writeFileSync(arquivo, restantes.length ? `${restantes.join('\n')}\n` : '', 'utf8');
    return item;
}

function devolverItemAoEstoque(nomeArquivo, item) {
    if (typeof item !== 'string' || !item.trim()) return;
    const arquivo = resolverArquivoEstoque(nomeArquivo);
    fs.appendFileSync(arquivo, `${item.trim()}\n`, 'utf8');
}

module.exports = {
    retirarItemDoEstoque,
    devolverItemAoEstoque
};
