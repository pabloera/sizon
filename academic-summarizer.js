require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { locateZoteroPDF, extractTextFromLocalPDF } = require('./pdf-locator');
const { Client } = require('@notionhq/client');

// Configuração
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const LLM_MODEL = 'gpt-4-turbo'; // ou outro modelo apropriado para textos longos

// Cliente do Notion
const notion = new Client({ auth: NOTION_API_KEY });

/**
 * Processa um artigo acadêmico e gera uma sumarização detalhada
 * @param {string} zoteroItemKey - ID do item no Zotero
 * @returns {Promise<Object|null>} - Objeto com a sumarização ou null em caso de erro
 */
async function processAcademicPaper(zoteroItemKey) {
  try {
    console.log(`Iniciando processamento acadêmico do item ${zoteroItemKey}...`);
    
    // 1. Localiza o PDF
    const pdfPath = await locateZoteroPDF(zoteroItemKey);
    if (!pdfPath) {
      console.log(`Não foi possível localizar o PDF para o item ${zoteroItemKey}`);
      return null;
    }
    
    // 2. Extrai o texto completo do PDF
    const fullText = await extractTextFromLocalPDF(pdfPath);
    if (!fullText || fullText.length < 100) {
      console.log(`Texto extraído muito curto ou falha na extração: ${zoteroItemKey}`);
      return null;
    }
    
    console.log(`Texto extraído com sucesso: ${fullText.length} caracteres`);
    
    // 3. Divide o texto em partes processáveis (chunking)
    const textChunks = chunkText(fullText, 12000);
    console.log(`Texto dividido em ${textChunks.length} chunks para processamento`);
    
    // 4. Processa cada chunk com o LLM para análise inicial
    const chunkAnalyses = [];
    for (let i = 0; i < textChunks.length; i++) {
      console.log(`Processando chunk ${i+1}/${textChunks.length}...`);
      const analysis = await analyzeTextChunk(textChunks[i], i+1, textChunks.length);
      chunkAnalyses.push(analysis);
      
      // Pequena pausa para evitar rate limiting
      if (i < textChunks.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    // 5. Sintetiza a análise final
    console.log('Sintetizando análise final...');
    const finalSummary = await synthesizeFinalSummary(chunkAnalyses);
    
    // 6. Atualiza o registro no Notion
    await updateNotionWithSummary(zoteroItemKey, finalSummary);
    
    return finalSummary;
    
  } catch (error) {
    console.error(`Erro ao processar artigo acadêmico ${zoteroItemKey}:`, error);
    return null;
  }
}

/**
 * Divide o texto em chunks de tamanho adequado
 * @param {string} text - Texto completo do documento
 * @param {number} chunkSize - Tamanho aproximado de cada chunk em caracteres
 * @returns {Array<string>} - Array de chunks de texto
 */
function chunkText(text, chunkSize = 12000) {
  const chunks = [];
  
  // Tenta dividir por seções naturais do documento (ex: quebras de linha duplas)
  const sections = text.split(/\n\s*\n/);
  
  let currentChunk = '';
  
  for (const section of sections) {
    // Se adicionar esta seção excede o tamanho do chunk, salva o atual e começa um novo
    if (currentChunk.length + section.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
    
    // Se a própria seção é maior que o tamanho do chunk, precisa dividi-la
    if (section.length > chunkSize) {
      // Se já temos conteúdo no chunk atual, salva primeiro
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      // Divide a seção grande em partes
      let remainingText = section;
      while (remainingText.length > 0) {
        const chunk = remainingText.substring(0, chunkSize);
        chunks.push(chunk);
        remainingText = remainingText.substring(chunkSize);
      }
    } else {
      // Adiciona a seção ao chunk atual
      currentChunk += section + '\n\n';
    }
  }
  
  // Adiciona o último chunk se não estiver vazio
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Analisa um chunk de texto usando o LLM
 * @param {string} textChunk - Parte do texto do documento
 * @param {number} chunkNumber - Número do chunk atual
 * @param {number} totalChunks - Número total de chunks
 * @returns {Promise<Object>} - Análise do chunk
 */
async function analyzeTextChunk(textChunk, chunkNumber, totalChunks) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é um assistente especializado em análise acadêmica rigorosa.
                     Analise este trecho de um artigo acadêmico (parte ${chunkNumber}/${totalChunks}) e extraia:
                     
                     1. Identificação do problema de pesquisa ou questões abordadas nesta seção
                     2. Metodologia mencionada ou utilizada nesta seção
                     3. Resultados ou evidências apresentados nesta seção
                     4. Argumentos teóricos ou conceituais importantes
                     5. Contribuições para o campo (se mencionadas)
                     6. Limitações mencionadas (se houver)
                     7. Conexões com a literatura (se citadas)
                     8. Conclusões ou implicações desta seção
                     
                     Responda apenas no formato JSON com estes campos exatos. Seja preciso e detalhado, 
                     baseando-se estritamente no texto apresentado. Se alguma informação não estiver 
                     presente nesta seção, indique "Não mencionado nesta seção" para o campo correspondente.`
          },
          {
            role: "user",
            content: textChunk
          }
        ],
        temperature: 0.2,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Tentativa de extrair o JSON válido da resposta
    try {
      return JSON.parse(response.data.choices[0].message.content);
    } catch (parseError) {
      // Se falhar ao parsear JSON, retorna o texto cru
      console.warn("Falha ao parsear resposta como JSON. Retornando texto bruto.");
      return {
        rawContent: response.data.choices[0].message.content,
        error: "Formato JSON inválido"
      };
    }
    
  } catch (error) {
    console.error(`Erro ao analisar chunk ${chunkNumber}:`, error);
    return {
      error: `Falha ao processar chunk ${chunkNumber}`,
      errorDetail: error.message
    };
  }
}

/**
 * Sintetiza uma análise final a partir das análises de chunks individuais
 * @param {Array<Object>} chunkAnalyses - Array de análises de chunks
 * @returns {Promise<Object>} - Sumarização final
 */
async function synthesizeFinalSummary(chunkAnalyses) {
  try {
    // Prepara o texto combinado das análises
    const combinedAnalysis = JSON.stringify(chunkAnalyses, null, 2);
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content: `Você é um especialista em síntese acadêmica.
                     Crie uma sumarização acadêmica robusta a partir das análises individuais 
                     de diferentes partes de um artigo. O resultado deve ser uma síntese 
                     acadêmica coerente, rigorosa e abrangente.
                     
                     Sua síntese DEVE incluir as seguintes seções (use estes títulos exatos):
                     
                     1. RESUMO GERAL: Um resumo conciso do trabalho completo (250-300 palavras)
                     
                     2. PROBLEMA DE PESQUISA: Articulação clara da pergunta ou problema central abordado
                     
                     3. METODOLOGIA: Descrição detalhada da metodologia utilizada
                     
                     4. RESULTADOS PRINCIPAIS: Exposição dos resultados mais significativos
                     
                     5. ARGUMENTAÇÃO TEÓRICA: Análise dos principais argumentos teóricos ou conceituais
                     
                     6. CONTRIBUIÇÕES PARA O CAMPO: Explicação das contribuições acadêmicas
                     
                     7. LIMITAÇÕES: Identificação de limitações mencionadas ou observadas
                     
                     8. CONEXÕES COM A LITERATURA: Relações com outros trabalhos na área
                     
                     9. IMPLICAÇÕES: Consequências teóricas ou práticas do trabalho
                     
                     10. ANÁLISE CRÍTICA: Avaliação crítica do trabalho (pontos fortes e fracos)
                     
                     Forneça a resposta em formato JSON com estas seções como campos.
                     Em cada seção, produza texto acadêmico rigoroso, baseado exclusivamente 
                     nas evidências encontradas no texto original. Seja detalhado e específico.`
          },
          {
            role: "user",
            content: `Aqui estão as análises de várias partes de um artigo acadêmico.
                     Sintetize uma análise final abrangente conforme as instruções:
                     
                     ${combinedAnalysis}`
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Tentativa de extrair o JSON válido da resposta
    try {
      return JSON.parse(response.data.choices[0].message.content);
    } catch (parseError) {
      // Se falhar no formato JSON, retorna um objeto estruturado com o conteúdo bruto
      console.warn("Falha ao parsear resposta final como JSON. Estruturando manualmente.");
      const rawContent = response.data.choices[0].message.content;
      
      // Tenta extrair as seções através de regex
      const sections = {
        resumoGeral: extractSection(rawContent, "RESUMO GERAL"),
        problemaDeaPlsquisa: extractSection(rawContent, "PROBLEMA DE PESQUISA"),
        metodologia: extractSection(rawContent, "METODOLOGIA"),
        resultadosPrincipais: extractSection(rawContent, "RESULTADOS PRINCIPAIS"),
        argumentacaoTeorica: extractSection(rawContent, "ARGUMENTAÇÃO TEÓRICA"),
        contribuicoesParaOCampo: extractSection(rawContent, "CONTRIBUIÇÕES PARA O CAMPO"),
        limitacoes: extractSection(rawContent, "LIMITAÇÕES"),
        conexoesComALiteratura: extractSection(rawContent, "CONEXÕES COM A LITERATURA"),
        implicacoes: extractSection(rawContent, "IMPLICAÇÕES"),
        analiseCritica: extractSection(rawContent, "ANÁLISE CRÍTICA"),
        rawContent: rawContent
      };
      
      return sections;
    }
    
  } catch (error) {
    console.error("Erro ao sintetizar análise final:", error);
    return {
      error: "Falha ao sintetizar análise final",
      errorDetail: error.message
    };
  }
}

/**
 * Extrai uma seção específica de um texto usando regex
 * @param {string} text - Texto completo
 * @param {string} sectionName - Nome da seção a extrair
 * @returns {string} - Conteúdo da seção
 */
function extractSection(text, sectionName) {
  const regex = new RegExp(`${sectionName}:\\s*([\\s\\S]*?)(?=\\d+\\.\\s+\\w+:|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : `Seção ${sectionName} não encontrada`;
}

/**
 * Atualiza o registro no Notion com a sumarização
 * @param {string} zoteroItemKey - ID do item no Zotero
 * @param {Object} summary - Objeto com a sumarização
 * @returns {Promise<boolean>} - Sucesso da operação
 */
async function updateNotionWithSummary(zoteroItemKey, summary) {
  try {
    // 1. Encontra o registro no Notion correspondente ao item do Zotero
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      filter: {
        property: "File Path", // Ajuste para o nome do campo que armazena o Zotero ID
        rich_text: {
          contains: zoteroItemKey
        }
      }
    });
    
    if (response.results.length === 0) {
      console.log(`Nenhum registro encontrado no Notion para o item ${zoteroItemKey}`);
      return false;
    }
    
    const pageId = response.results[0].id;
    
    // 2. Formata o conteúdo para o Notion
    let summaryContent = '';
    
    // Resume Geral no topo como principal
    if (summary.resumoGeral) {
      summaryContent += `${summary.resumoGeral}\n\n`;
    }
    
    // Adiciona as demais seções com formatação adequada
    const sections = [
      { title: "Problema de Pesquisa", content: summary.problemaDeaPlsquisa || summary.problemaDePesquisa },
      { title: "Metodologia", content: summary.metodologia },
      { title: "Resultados Principais", content: summary.resultadosPrincipais },
      { title: "Argumentação Teórica", content: summary.argumentacaoTeorica },
      { title: "Contribuições para o Campo", content: summary.contribuicoesParaOCampo },
      { title: "Limitações", content: summary.limitacoes },
      { title: "Conexões com a Literatura", content: summary.conexoesComALiteratura },
      { title: "Implicações", content: summary.implicacoes },
      { title: "Análise Crítica", content: summary.analiseCritica }
    ];
    
    // Adiciona cada seção disponível
    for (const section of sections) {
      if (section.content) {
        summaryContent += `**${section.title}**\n${section.content}\n\n`;
      }
    }
    
    // 3. Atualiza o registro no Notion
    await notion.pages.update({
      page_id: pageId,
      properties: {
        // Adiciona propriedade indicando que tem resumo AI avançado
        "Estado": {
          status: {
            name: "Resumo AI Avançado" // Ajuste para um valor válido em seu banco
          }
        }
      },
      // Atualiza o conteúdo da página
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: "Resumo Acadêmico" } }]
          }
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: summaryContent } }]
          }
        }
      ]
    });
    
    console.log(`Registro atualizado com sucesso no Notion para o item ${zoteroItemKey}`);
    return true;
    
  } catch (error) {
    console.error(`Erro ao atualizar registro no Notion para ${zoteroItemKey}:`, error);
    return false;
  }
}

/**
 * Verifica se o Notion permite blocos de conteúdo e cria uma página de conteúdo
 * mais rica, caso seja possível
 */
async function createRichNotionContent(pageId, summary) {
  try {
    // Esta implementação depende da API do Notion e das limitações específicas
    // da sua integração. A estrutura abaixo é uma sugestão avançada.
    
    const blocks = [
      {
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: "Resumo Acadêmico Avançado" } }]
        }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: summary.resumoGeral } }]
        }
      }
    ];
    
    // Adiciona cada seção como heading + parágrafo
    const sections = [
      { title: "Problema de Pesquisa", content: summary.problemaDeaPlsquisa || summary.problemaDePesquisa },
      { title: "Metodologia", content: summary.metodologia },
      { title: "Resultados Principais", content: summary.resultadosPrincipais },
      { title: "Argumentação Teórica", content: summary.argumentacaoTeorica },
      { title: "Contribuições para o Campo", content: summary.contribuicoesParaOCampo },
      { title: "Limitações", content: summary.limitacoes },
      { title: "Conexões com a Literatura", content: summary.conexoesComALiteratura },
      { title: "Implicações", content: summary.implicacoes },
      { title: "Análise Crítica", content: summary.analiseCritica }
    ];
    
    for (const section of sections) {
      if (section.content) {
        blocks.push(
          {
            object: "block",
            type: "heading_2",
            heading_2: {
              rich_text: [{ type: "text", text: { content: section.title } }]
            }
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: section.content } }]
            }
          }
        );
      }
    }
    
    // Atualiza o conteúdo da página
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks
    });
    
    return true;
  } catch (error) {
    console.error("Erro ao criar conteúdo rico no Notion:", error);
    return false;
  }
}

// Exemplo de uso do processador
/*
(async () => {
  const zoteroItemKey = 'ABC12345'; // Substitua pelo ID real de um item do Zotero
  const summary = await processAcademicPaper(zoteroItemKey);
  
  if (summary) {
    console.log('Sumarização concluída com sucesso!');
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('Falha ao processar o artigo.');
  }
})();
*/

module.exports = {
  processAcademicPaper
};