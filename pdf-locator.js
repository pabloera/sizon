const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuração
const ZOTERO_STORAGE_PATH = '/Users/pabloalmada/Zotero/storage';
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;

/**
 * Encontra o caminho local para o PDF de um item do Zotero
 * @param {string} itemKey - O ID do item no Zotero (chave de 8 caracteres)
 * @returns {Promise<string|null>} - Caminho completo para o PDF ou null se não encontrado
 */
async function locateZoteroPDF(itemKey) {
  try {
    console.log(`Localizando PDF para o item ${itemKey}...`);
    
    // Primeiro, verifica se o item é um anexo PDF direto
    let pdfPath = await findPDFDirectly(itemKey);
    if (pdfPath) {
      console.log(`PDF encontrado diretamente: ${pdfPath}`);
      return pdfPath;
    }
    
    // Se não for, busca anexos do item
    try {
      const response = await axios.get(
        `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${itemKey}/children?format=json`,
        {
          headers: {
            'Zotero-API-Key': ZOTERO_API_KEY,
          },
        }
      );
      
      // Filtra apenas anexos PDF
      const pdfAttachments = response.data.filter(item => 
        item.data.contentType === 'application/pdf' && 
        (item.data.linkMode === 'imported_file' || item.data.linkMode === 'imported_url')
      );
      
      if (pdfAttachments.length === 0) {
        console.log(`Nenhum anexo PDF encontrado para o item ${itemKey}`);
        return null;
      }
      
      // Para cada anexo, tenta localizar o arquivo localmente
      for (const attachment of pdfAttachments) {
        pdfPath = await findPDFDirectly(attachment.key);
        if (pdfPath) {
          console.log(`PDF encontrado via anexo: ${pdfPath}`);
          return pdfPath;
        }
      }
      
      console.log(`Não foi possível localizar os anexos PDF no sistema de arquivos local para o item ${itemKey}`);
      return null;
    } catch (error) {
      console.error(`Erro ao buscar anexos do item ${itemKey}:`, error);
      return null;
    }
  } catch (error) {
    console.error(`Erro ao localizar PDF para o item ${itemKey}:`, error);
    return null;
  }
}

/**
 * Tenta encontrar um PDF diretamente no sistema de arquivos local
 * @param {string} key - A chave do item (attachment) no Zotero
 * @returns {Promise<string|null>} - Caminho para o arquivo ou null se não encontrado
 */
async function findPDFDirectly(key) {
  // Verifica se existe um diretório para este item no storage
  const itemDir = path.join(ZOTERO_STORAGE_PATH, key);
  
  if (!fs.existsSync(itemDir)) {
    return null;
  }
  
  // Lista todos os arquivos no diretório
  const files = fs.readdirSync(itemDir);
  
  // Procura por arquivos PDF
  const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
  
  if (pdfFiles.length > 0) {
    return path.join(itemDir, pdfFiles[0]);
  }
  
  return null;
}

/**
 * Função para extrair texto de um PDF local
 * @param {string} pdfPath - Caminho completo para o arquivo PDF
 * @returns {Promise<string|null>} - Texto extraído do PDF ou null em caso de erro
 */
async function extractTextFromLocalPDF(pdfPath) {
  try {
    // Certifique-se de que o módulo pdf-parse está disponível
    const pdf = require('pdf-parse');
    
    // Lê o arquivo
    const dataBuffer = fs.readFileSync(pdfPath);
    
    // Extrai o texto
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error(`Erro ao extrair texto do PDF ${pdfPath}:`, error);
    return null;
  }
}

// Exemplo de uso:
/*
(async () => {
  const itemKey = 'ABC12345'; // Substitua pelo ID real de um item do Zotero
  const pdfPath = await locateZoteroPDF(itemKey);
  
  if (pdfPath) {
    console.log(`PDF encontrado em: ${pdfPath}`);
    const text = await extractTextFromLocalPDF(pdfPath);
    console.log(`Texto extraído (primeiros 500 caracteres): ${text.substring(0, 500)}`);
  } else {
    console.log('PDF não encontrado.');
  }
})();
*/

module.exports = {
  locateZoteroPDF,
  extractTextFromLocalPDF
};