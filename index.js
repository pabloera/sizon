// ============================================================================
// Middleware de Integração Zotero-Notion-LLM
// ============================================================================

require('dotenv').config();
const { Client } = require('@notionhq/client');
const axios = require('axios');
const { PizZip } = require('pizzip');
const { DOMParser } = require('xmldom');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

// Configuração das APIs
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const notion = new Client({ auth: NOTION_API_KEY });

// ============================================================================
// 1. Funções para integração com o Zotero
// ============================================================================

// Busca itens recentes no Zotero
async function fetchRecentZoteroItems(limit = 10) {
  try {
    const response = await axios.get(
      `https://api.zotero.org/users/${ZOTERO_USER_ID}/items?limit=${limit}&format=json`,
      {
        headers: {
          'Zotero-API-Key': ZOTERO_API_KEY,
        },
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar itens do Zotero:', error);
    throw error;
  }
}

// Baixa o PDF associado a um item do Zotero
async function downloadPDFFromZotero(itemKey) {
  try {
    // Primeiro, busca o anexo associado ao item
    const response = await axios.get(
      `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${itemKey}/children?format=json`,
      {
        headers: {
          'Zotero-API-Key': ZOTERO_API_KEY,
        },
      }
    );
    
    const attachments = response.data.filter(
      item => item.data.contentType === 'application/pdf'
    );
    
    if (attachments.length === 0) {
      console.log(`Nenhum PDF encontrado para o item ${itemKey}`);
      return null;
    }
    
    // Baixa o PDF
    const pdfKey = attachments[0].key;
    const pdfResponse = await axios.get(
      `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${pdfKey}/file`,
      {
        headers: {
          'Zotero-API-Key': ZOTERO_API_KEY,
        },
        responseType: 'arraybuffer',
      }
    );
    
    const filePath = path.join(__dirname, 'temp', `${itemKey}.pdf`);
    fs.writeFileSync(filePath, pdfResponse.data);
    
    return filePath;
  } catch (error) {
    console.error(`Erro ao baixar PDF do item ${itemKey}:`, error);
    return null;
  }
}

// Atualiza metadados no Zotero
async function updateZoteroMetadata(itemKey, metadata) {
  try {
    // Primeiro, busca o item atual para manter os campos existentes
    const response = await axios.get(
      `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${itemKey}?format=json`,
      {
        headers: {
          'Zotero-API-Key': ZOTERO_API_KEY,
        },
      }
    );
    
    const currentData = response.data.data;
    const version = response.data.version;
    
    // Mescla os metadados atuais com os novos
    const updatedData = { ...currentData, ...metadata };
    
    // Atualiza o item no Zotero
    await axios.put(
      `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${itemKey}`,
      {
        data: updatedData,
        version: version,
      },
      {
        headers: {
          'Zotero-API-Key': ZOTERO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log(`Metadados atualizados para o item ${itemKey} no Zotero`);
    return true;
  } catch (error) {
    console.error(`Erro ao atualizar metadados do item ${itemKey} no Zotero:`, error);
    return false;
  }
}

// ============================================================================
// 2. Funções para processamento LLM
// ============================================================================

// Extrai texto de um PDF
async function extractTextFromPDF(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Erro ao extrair texto do PDF:', error);
    return null;
  }
}

// Utiliza IA para extrair metadados de um documento
async function extractMetadataWithLLM(pdfText, existingMetadata = {}) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4o-mini-2024-07-18",
        messages: [
          {
            role: "system",
            content: `Você é um assistente especializado em análise bibliográfica. 
                     Extraia os metadados precisos deste documento acadêmico.
                     Forneça apenas um objeto JSON com os seguintes campos (quando disponíveis):
                     title, authors (array), year, publisher, journal, volume, issue, pages, isbn, doi, abstract`
          },
          {
            role: "user",
            content: `Extraia os metadados do seguinte texto (primeiras páginas de um documento acadêmico): 
                     ${pdfText.substring(0, 10000)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const llmMetadata = JSON.parse(response.data.choices[0].message.content);
    
    // Mescla com os metadados existentes, priorizando os novos
    const mergedMetadata = { ...existingMetadata };
    
    // Apenas substituímos campos vazios ou incompletos
    Object.keys(llmMetadata).forEach(key => {
      if (!mergedMetadata[key] || 
          (typeof mergedMetadata[key] === 'string' && mergedMetadata[key].trim() === '') ||
          (Array.isArray(mergedMetadata[key]) && mergedMetadata[key].length === 0)) {
        mergedMetadata[key] = llmMetadata[key];
      }
    });
    
    return mergedMetadata;
  } catch (error) {
    console.error('Erro ao extrair metadados com IA:', error);
    return existingMetadata;
  }
}

// Gera resumo e análise do documento
async function generateSummaryWithLLM(pdfText) {
  try {
    // Divida o texto em chunks para processar documentos longos
    const chunkSize = 12000;
    const chunks = [];
    
    for (let i = 0; i < pdfText.length; i += chunkSize) {
      chunks.push(pdfText.substring(i, i + chunkSize));
    }
    
    let summary = '';
    let keyPoints = [];
    
    // Processa o texto em chunks
    for (let i = 0; i < chunks.length; i++) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: "gpt-4o-mini-2024-07-18",
          messages: [
            {
              role: "system",
              content: `Você é um assistente especializado em análise de literatura acadêmica.
                       Analise o seguinte trecho de texto acadêmico (parte ${i+1}/${chunks.length}) e extraia:
                       1. Um breve resumo do conteúdo
                       2. Pontos-chave e conclusões
                       3. Metodologia utilizada (se aplicável)
                       4. Limitações mencionadas (se aplicável)
                       Forneça apenas um objeto JSON com estes campos.`
            },
            {
              role: "user",
              content: chunks[i]
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const result = JSON.parse(response.data.choices[0].message.content);
      
      // Acumula os resultados
      summary += (result.resumo || '') + ' ';
      if (result.pontosChave) {
        keyPoints = [...keyPoints, ...result.pontosChave];
      }
    }
    
    // Finaliza com uma síntese geral para documentos com múltiplos chunks
    if (chunks.length > 1) {
      const finalResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: "gpt-4o-mini-2024-07-18",
          messages: [
            {
              role: "system",
              content: `Você é um assistente especializado em síntese de literatura acadêmica.
                       Crie uma síntese coesa do seguinte resumo, eliminando redundâncias e
                       organizando os pontos-chave. Limite a resposta a 500 palavras.`
            },
            {
              role: "user",
              content: summary
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      summary = finalResponse.data.choices[0].message.content;
    }
    
    return {
      summary,
      keyPoints: Array.from(new Set(keyPoints)) // Remove duplicatas
    };
  } catch (error) {
    console.error('Erro ao gerar resumo com IA:', error);
    return {
      summary: "Erro ao gerar resumo.",
      keyPoints: []
    };
  }
}

// Gera resumo e análise do documento
async function generateSummaryWithLLM(pdfText) {
  try {
    // ... código existente ...
  } catch (error) {
    console.error('Erro ao gerar resumo com IA:', error);
    return {
      summary: "Erro ao gerar resumo.",
      keyPoints: []
    };
  }
}

// Gera resumo baseado apenas nos metadados (quando não há PDF)
// Gera resumo baseado apenas nos metadados (quando não há PDF)
async function generateSummaryFromMetadata(metadata) {
  try {
    // Extrai autores para o prompt
    let authorsText = "";
    if (Array.isArray(metadata.creators)) {
      authorsText = metadata.creators
        .map(c => `${c.firstName || ""} ${c.lastName || ""}`)
        .join(", ");
    } else if (Array.isArray(metadata.authors)) {
      authorsText = metadata.authors.join(", ");
    }
    
    // Extrai tags para o prompt
    let tagsText = "";
    if (Array.isArray(metadata.tags)) {
      tagsText = metadata.tags
        .map(t => typeof t === 'string' ? t : (t.tag || ""))
        .join(", ");
    }
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `Você é um assistente especializado em análise bibliográfica.
                     Com base apenas nos metadados desta referência, gere um breve resumo
                     do que provavelmente aborda e alguns pontos-chave potenciais.
                     Indique claramente que isto é baseado em metadados, não no texto completo.
                     Forneça como um objeto JSON simples com campos "summary" e "keyPoints" (array).
                     Não use formatação Markdown ou blocos de código. Retorne o JSON puro.`
          },
          {
            role: "user",
            content: `Metadados da referência bibliográfica:
                     Título: ${metadata.title || "Não disponível"}
                     Autores: ${authorsText || "Não disponível"}
                     Ano: ${metadata.date || metadata.year || "Não disponível"}
                     Publicação: ${metadata.publicationTitle || metadata.publisher || "Não disponível"}
                     Tipo de item: ${metadata.itemType || "Não disponível"}
                     Tags: ${tagsText || "Não disponíveis"}
                     Abstract: ${metadata.abstractNote || "Não disponível"}`
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Extrai o JSON da resposta, removendo qualquer formatação Markdown
    const content = response.data.choices[0].message.content.trim();
    let jsonStr = content;
    
    // Remove formatação Markdown (blocos de código com ```)
    if (content.includes('```')) {
      // Extrai o conteúdo entre os blocos de código
      const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
    }
    
    try {
      // Tenta parsear o JSON
      const result = JSON.parse(jsonStr);
      return {
        summary: result.summary || "Resumo gerado apenas com base nos metadados disponíveis, sem acesso ao texto completo.",
        keyPoints: result.keyPoints || []
      };
    } catch (jsonError) {
      // Se falhar no parse, cria um resumo simples baseado nos metadados
      console.error("Erro ao parsear JSON na resposta:", jsonError);
      return {
        summary: `Este é um resumo automático baseado apenas nos metadados disponíveis do documento "${metadata.title || 'Sem título'}" de ${authorsText || 'autor desconhecido'} (${metadata.date || metadata.year || 'data desconhecida'}). Como não foi possível acessar o texto completo, este resumo é uma estimativa do conteúdo.`,
        keyPoints: ["Metadados limitados disponíveis, sem acesso ao texto completo"]
      };
    }
  } catch (error) {
    console.error('Erro ao gerar resumo a partir dos metadados:', error);
    return {
      summary: "Não foi possível gerar um resumo a partir dos metadados disponíveis.",
      keyPoints: []
    };
  }
}

// ============================================================================
// 3. Funções para integração com o Notion
// ============================================================================


// ============================================================================
// 3. Funções para integração com o Notion
// ============================================================================

// Busca registros existentes no banco de dados do Notion
// Busca registros existentes no banco de dados do Notion
async function findNotionRecordByZoteroId(zoteroId) {
  try {
    // Tenta buscar o registro pelo File Path que armazenará o ID do Zotero
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      filter: {
        property: "File Path", // Mude para uma propriedade existente no seu banco
        rich_text: {
          contains: zoteroId // Usamos "contains" em vez de "equals" para ser mais flexível
        }
      }
    });
    
    if (response.results.length > 0) {
      return response.results[0];
    }
    
    return null;
  } catch (error) {
    console.error('Erro ao buscar registro no Notion:', error);
    return null;
  }
}

// Atualiza ou cria um registro no Notion
// Atualiza ou cria um registro no Notion
async function updateNotionRecord(zoteroId, metadata, analysis) {
  try {
    // Verifica se o registro já existe
    const existingRecord = await findNotionRecordByZoteroId(zoteroId);
    
    // Prepara as propriedades para o Notion
    const properties = {
      // Use o título como título principal
      "Name": {
        title: [
          {
            text: {
              content: metadata.title || "Sem título"
            }
          }
        ]
      },
      // Armazena o ID do Zotero em File Path para referência futura
      "File Path": {
        rich_text: [
          {
            text: {
              content: zoteroId
            }
          }
        ]
      },
      "Abstract": {
        rich_text: [
          {
            text: {
              content: metadata.abstractNote || analysis.summary || ""
            }
          }
        ]
      },
      "Authors": {
        rich_text: [
          {
            text: {
              content: Array.isArray(metadata.creators) 
                ? metadata.creators.map(c => `${c.firstName || ""} ${c.lastName || ""}`).join(", ")
                : (Array.isArray(metadata.authors) ? metadata.authors.join(", ") : "")
            }
          }
        ]
      },
      "Year": {
        number: parseInt(metadata.date?.substring(0, 4)) || parseInt(metadata.year) || null
      },
      "Item Type": {
        select: {
          name: metadata.itemType || "article"
        }
      },
      // Date precisa ser rich_text, não date
      "Date": {
        rich_text: [
          {
            text: {
              content: metadata.date || ""
            }
          }
        ]
      },
      "Zotero URI": {
        url: `zotero://select/items/${zoteroId}`
      },
      "Full Citation": {
        rich_text: [
          {
            text: {
              content: metadata.fullCitation || `${metadata.title} (${metadata.date?.substring(0, 4) || metadata.year || "n.d."})`
            }
          }
        ]
      },
      "In-Text Citation": {
        rich_text: [
          {
            text: {
              content: metadata.inTextCitation || ""
            }
          }
        ]
      },
      "My Comments": {
        rich_text: [
          {
            text: {
              content: analysis.keyPoints.join("\n• ") || ""
            }
          }
        ]
      },
      "Tags": {
        multi_select: Array.isArray(metadata.tags) 
          ? metadata.tags.map(tag => {
              // Verifica se é um objeto ou string
              if (typeof tag === 'object' && tag !== null) {
                return { name: String(tag.tag || "tag") };
              } else {
                return { name: String(tag || "tag") };
              }
            }).slice(0, 10) // Limita a 10 tags para evitar limites do Notion
          : []
      },
      // Estado precisa ser status, não select
      "Estado": {
        status: {
          name: "Por ler" // Use um valor válido da sua propriedade status
        }
      }
    };
    
    if (existingRecord) {
      // Atualiza o registro existente
      await notion.pages.update({
        page_id: existingRecord.id,
        properties
      });
      
      console.log(`Registro atualizado no Notion para o item ${zoteroId}`);
    } else {
      // Cria um novo registro
      await notion.pages.create({
        parent: {
          database_id: NOTION_DATABASE_ID
        },
        properties
      });
      
      console.log(`Novo registro criado no Notion para o item ${zoteroId}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Erro ao atualizar/criar registro no Notion para ${zoteroId}:`, error);
    return false;
  }
}


// Gera citações para o item
// Gera citações para o item
async function generateCitations(metadata) {
  try {
    // Extrai autores para o prompt
    let authorsText = "";
    if (Array.isArray(metadata.creators)) {
      authorsText = metadata.creators
        .map(c => `${c.firstName || ""} ${c.lastName || ""}`)
        .join(", ");
    } else if (Array.isArray(metadata.authors)) {
      authorsText = metadata.authors.join(", ");
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4o-mini-2024-07-18",
        messages: [
          {
            role: "system",
            content: `Você é um assistente especializado em citações acadêmicas.
                     Gere citações nos formatos APA e in-text para esta referência bibliográfica.
                     Responda APENAS em formato JSON válido com os campos "fullCitation" (formato APA completo)
                     e "inTextCitation" (formato entre parênteses para citação no texto).
                     Não inclua explicações ou texto adicional fora do objeto JSON.`
          },
          {
            role: "user",
            content: `Título: ${metadata.title || ""}
                     Autores: ${authorsText || ""}
                     Ano: ${metadata.date?.substring(0, 4) || metadata.year || ""}
                     Editora: ${metadata.publisher || ""}
                     Journal: ${metadata.publicationTitle || ""}
                     Volume: ${metadata.volume || ""}
                     Edição: ${metadata.issue || ""}
                     Páginas: ${metadata.pages || ""}
                     DOI: ${metadata.DOI || ""}`
          }
        ],
        temperature: 0.1, // Reduzido para maior consistência
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Tratamento de erro adicional para garantir JSON válido
    try {
      // Tenta extrair o JSON da resposta
      const content = response.data.choices[0].message.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        // Se não encontrou um objeto JSON, cria um manualmente
        console.log("Resposta não contém JSON válido, usando valores padrão");
        const authorLastName = authorsText.split(' ').pop() || 'Autor';
        const year = metadata.date?.substring(0, 4) || metadata.year || 'n.d.';
        
        return {
          fullCitation: `${authorsText}. (${year}). ${metadata.title}.`,
          inTextCitation: `(${authorLastName}, ${year})`
        };
      }
    } catch (jsonError) {
      console.error("Erro ao parsear JSON na resposta:", jsonError);
      const authorLastName = authorsText.split(' ').pop() || 'Autor';
      const year = metadata.date?.substring(0, 4) || metadata.year || 'n.d.';
      
      return {
        fullCitation: `${authorsText}. (${year}). ${metadata.title}.`,
        inTextCitation: `(${authorLastName}, ${year})`
      };
    }
  } catch (error) {
    console.error('Erro ao gerar citações:', error);
    return {
      fullCitation: `${metadata.title || "Documento sem título"}`,
      inTextCitation: "(sem citação)"
    };
  }
}

// ============================================================================
// 4. Função principal - Orquestra o fluxo completo
// ============================================================================
// Processa um item do Zotero
async function processZoteroItem(itemKey) {
  try {
    console.log(`Processando item ${itemKey} do Zotero...`);
    
    // 1. Busca metadados existentes no Zotero primeiro
    let zoteroResponse;
    let existingMetadata;
    
    try {
      zoteroResponse = await axios.get(
        `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${itemKey}?format=json`,
        {
          headers: {
            'Zotero-API-Key': ZOTERO_API_KEY,
          },
        }
      );
      
      existingMetadata = zoteroResponse.data.data;
      console.log(`Metadados básicos obtidos para o item ${itemKey}`);
      
      // Se este é um anexo URL do Notero, tenta obter o item pai
      if (existingMetadata.itemType === 'attachment' && existingMetadata.linkMode === 'linked_url' 
          && existingMetadata.url && existingMetadata.url.startsWith('notion://')) {
        
        console.log("Item detectado como anexo Notero. Buscando item pai...");
        
        if (existingMetadata.parentItem) {
          const parentResponse = await axios.get(
            `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${existingMetadata.parentItem}?format=json`,
            {
              headers: {
                'Zotero-API-Key': ZOTERO_API_KEY,
              },
            }
          );
          
          // Substitui os metadados pelo item pai
          existingMetadata = parentResponse.data.data;
          itemKey = existingMetadata.key; // Atualiza a chave do item para o item pai
          console.log(`Usando item pai: ${existingMetadata.title} (${itemKey})`);
        }
      }
      
    } catch (error) {
      console.error(`Erro ao buscar metadados para o item ${itemKey}:`, error);
      return false;
    }
    
    // 2. Tenta baixar o PDF, mas continua mesmo se falhar
    let pdfText = "";
    let hasPDF = false;
    
    try {
      const pdfPath = await downloadPDFFromZotero(itemKey);
      if (pdfPath) {
        hasPDF = true;
        pdfText = await extractTextFromPDF(pdfPath) || "";
        console.log(`Texto extraído do PDF para o item ${itemKey}`);
        
        // Limpa arquivos temporários se tiver PDF
        fs.unlinkSync(pdfPath);
      } else {
        console.log(`Nenhum PDF encontrado para o item ${itemKey}. Continuando apenas com metadados.`);
      }
    } catch (error) {
      console.log(`Não foi possível baixar ou processar o PDF para o item ${itemKey}. Continuando apenas com metadados.`);
    }
    
    // 3. Prepara metadados avançados - com ou sem PDF
    let enhancedMetadata = { ...existingMetadata };
    let analysis = { summary: "", keyPoints: [] };
    
    // Extrai autores dos metadados do Zotero para usar com as APIs de IA
    let authors = [];
    if (Array.isArray(existingMetadata.creators)) {
      authors = existingMetadata.creators.map(
        creator => `${creator.firstName || ""} ${creator.lastName || ""}`
      ).filter(name => name.trim() !== "");
    }
    enhancedMetadata.authors = authors;
    
    // Se tiver texto do PDF, usa LLM para extrair informações
    if (pdfText && pdfText.length > 0) {
      enhancedMetadata = await extractMetadataWithLLM(pdfText, enhancedMetadata);
      analysis = await generateSummaryWithLLM(pdfText);
    } else {
      // Sem PDF, gera resumo e análise a partir dos metadados disponíveis
      analysis = await generateSummaryFromMetadata(enhancedMetadata);
    }
    
    // 4. Gera citações a partir dos metadados
    const citations = await generateCitations(enhancedMetadata);
    enhancedMetadata.fullCitation = citations.fullCitation;
    enhancedMetadata.inTextCitation = citations.inTextCitation;
    
    // 5. Atualiza o registro no Notion
    await updateNotionRecord(itemKey, enhancedMetadata, analysis);
    
    console.log(`Processamento concluído para o item ${itemKey}`);
    return true;
  } catch (error) {
    console.error(`Erro ao processar item ${itemKey}:`, error);
    return false;
  }
}

// ============================================================================
// 5. Funções para monitoramento e processamento em lote
// ============================================================================

// Monitora novos itens no Zotero
async function monitorZoteroForNewItems() {
  try {
    console.log("Iniciando monitoramento de novos itens no Zotero...");
    
    // Armazena a última data/hora verificada
    let lastChecked = new Date();
    
    // Verifica a cada 30 minutos
    setInterval(async () => {
      console.log("Verificando novos itens no Zotero...");
      
      // Busca itens modificados desde a última verificação
      const formattedDate = lastChecked.toISOString().replace('Z', '+00:00');
      
      const response = await axios.get(
        `https://api.zotero.org/users/${ZOTERO_USER_ID}/items?since=${formattedDate}&format=json`,
        {
          headers: {
            'Zotero-API-Key': ZOTERO_API_KEY,
          },
        }
      );
      
      const newItems = response.data;
      console.log(`${newItems.length} novos/modificados itens encontrados`);
      
      // Processa cada novo item
      for (const item of newItems) {
        if (item.data.itemType !== 'attachment') {
          await processZoteroItem(item.key);
        }
      }
      
      // Atualiza a última verificação
      lastChecked = new Date();
    }, 30 * 60 * 1000); // 30 minutos
    
  } catch (error) {
    console.error("Erro no monitoramento do Zotero:", error);
  }
}

// Processa itens em lote
async function batchProcessZoteroItems(limit = 10) {
  try {
    console.log(`Iniciando processamento em lote de até ${limit} itens do Zotero...`);
    
    // Busca os itens mais recentes
    const items = await fetchRecentZoteroItems(limit);
    
    console.log(`${items.length} itens encontrados para processamento`);
    
    // Processa cada item
    for (const item of items) {
      if (item.data.itemType !== 'attachment') {
        await processZoteroItem(item.key);
      }
    }
    
    console.log("Processamento em lote concluído");
  } catch (error) {
    console.error("Erro no processamento em lote:", error);
  }
}

// // Mantenha todo o seu código existente, mas modifique o final para exportar as funções

// ============================================================================
// Inicialização
// ============================================================================

// Cria diretório temporário se não existir
if (!fs.existsSync(path.join(__dirname, 'temp'))) {
  fs.mkdirSync(path.join(__dirname, 'temp'));
}

// Variáveis para controle do monitoramento
let monitoringActive = false;
let monitoringInterval = null;

// Versão modificada da função monitorZoteroForNewItems que permite controle externo
async function startMonitoring() {
  if (monitoringActive) {
    console.log("Monitoramento já está ativo");
    return false;
  }

  try {
    console.log("Iniciando monitoramento de novos itens no Zotero...");
    
    monitoringActive = true;
    
    // Armazena a última data/hora verificada
    let lastChecked = new Date();
    
    // Verifica a cada 30 minutos
    monitoringInterval = setInterval(async () => {
      console.log("Verificando novos itens no Zotero...");
      
      try {
        // Busca itens modificados desde a última verificação
        const formattedDate = lastChecked.toISOString();

        const response = await axios.get(
          `https://api.zotero.org/users/${ZOTERO_USER_ID}/items?since=${formattedDate}&format=json`,
          {
            headers: {
              'Zotero-API-Key': ZOTERO_API_KEY,
            },
          }
        );
        
        const newItems = response.data;
        console.log(`${newItems.length} novos/modificados itens encontrados`);
        
        // Processa cada novo item
        for (const item of newItems) {
          if (item.data.itemType !== 'attachment') {
            await processZoteroItem(item.key);
          }
        }
        
        // Atualiza a última verificação
        lastChecked = new Date();
      } catch (error) {
        console.error("Erro ao verificar novos itens:", error);
      }
    }, 30 * 60 * 1000); // 30 minutos
    
    return true;
  } catch (error) {
    console.error("Erro no monitoramento do Zotero:", error);
    monitoringActive = false;
    return false;
  }
}

// Função para parar o monitoramento
function stopMonitoring() {
  if (!monitoringActive) {
    console.log("Monitoramento já está inativo");
    return false;
  }
  
  try {
    clearInterval(monitoringInterval);
    monitoringActive = false;
    monitoringInterval = null;
    console.log("Monitoramento interrompido com sucesso");
    return true;
  } catch (error) {
    console.error("Erro ao interromper monitoramento:", error);
    return false;
  }
}

// Função para verificar o status atual
function getStatus() {
  return {
    isMonitoringActive: monitoringActive,
    lastUpdated: new Date().toISOString()
  };
}

// Executar o processamento inicial (você pode comentar isto quando usar o controle via API)
batchProcessZoteroItems(5);
startMonitoring();

// Exporta as funções para uso externo
module.exports = {
  processZoteroItem,
  batchProcessZoteroItems,
  startMonitoring,
  stopMonitoring,
  getStatus,
  fetchRecentZoteroItems 
};
// Version 3 of 3 ============================================================================