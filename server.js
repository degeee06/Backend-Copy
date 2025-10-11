const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ✅ NOVO: Rate Limiting
const rateLimitMap = new Map();

const rateLimit = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutos
    const maxRequests = 50; // 50 requests por janela
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, startTime: now });
        return next();
    }
    
    const userData = rateLimitMap.get(ip);
    
    if (now - userData.startTime > windowMs) {
        // Reset window
        rateLimitMap.set(ip, { count: 1, startTime: now });
        return next();
    }
    
    if (userData.count >= maxRequests) {
        return res.status(429).json({ 
            error: 'Muitas requisições. Tente novamente em 15 minutos.' 
        });
    }
    
    userData.count++;
    next();
};

// ✅ NOVO: Validação de entrada
const validateGenerateRequest = (req, res, next) => {
    const { prompt, template } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt é obrigatório e deve ser uma string' });
    }
    
    if (prompt.length > 1000) {
        return res.status(400).json({ error: 'Prompt muito longo (máx: 1000 caracteres)' });
    }
    
    if (prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Prompt não pode estar vazio' });
    }
    
    const validTemplates = ['instagram', 'facebook', 'ecommerce', 'email', 'google', 'blog'];
    if (!validTemplates.includes(template)) {
        return res.status(400).json({ error: 'Template inválido' });
    }
    
    next();
};

// ✅ NOVO: Logging aprimorado
const logger = {
    info: (message, data = {}) => {
        console.log(`📝 [INFO] ${new Date().toISOString()}: ${message}`, data);
    },
    error: (message, error = {}) => {
        console.error(`❌ [ERROR] ${new Date().toISOString()}: ${message}`, {
            error: error.message,
            stack: error.stack
        });
    },
    warn: (message, data = {}) => {
        console.warn(`⚠️ [WARN] ${new Date().toISOString()}: ${message}`, data);
    }
};

app.use(cors());
app.use(express.json());

// ✅ MELHORADO: Rota para gerar conteúdo com prompts otimizados
app.post('/api/generate', rateLimit, validateGenerateRequest, async (req, res) => {
    try {
        const { prompt, template, context = {} } = req.body;

        logger.info('Gerando conteúdo melhorado', { 
            template, 
            promptLength: prompt.length,
            context: Object.keys(context) 
        });

        // ✅ SISTEMA DE PROMPTS OTIMIZADOS POR TEMPLATE
        const enhancedPrompt = buildEnhancedPrompt(prompt, template, context);
        
        const systemMessage = {
            role: "system",
            content: getSystemMessage(template)
        };

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [systemMessage, { role: "user", content: enhancedPrompt }],
                max_tokens: 1500,
                temperature: getTemperature(template), // ✅ Temperatura dinâmica
                top_p: 0.9,
                frequency_penalty: 0.2, // ✅ Reduz repetição
                presence_penalty: 0.1,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('Erro na API DeepSeek', { 
                status: response.status,
                error: errorText 
            });
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let generatedContent = data.choices[0].message.content;

        // ✅ PÓS-PROCESSAMENTO para melhor qualidade
        generatedContent = postProcessContent(generatedContent, template);

        logger.info('Conteúdo gerado com sucesso', { 
            contentLength: generatedContent.length,
            template,
            tokens: data.usage?.total_tokens 
        });

        // Salvar no Supabase
        try {
            const { data: dbData, error } = await supabase
                .from('generated_content')
                .insert([
                    {
                        template_type: template,
                        prompt: prompt,
                        enhanced_prompt: enhancedPrompt, // ✅ Salvar prompt melhorado
                        content: generatedContent,
                        tokens_used: data.usage?.total_tokens,
                        created_at: new Date().toISOString()
                    }
                ]);

            if (error) {
                logger.error('Erro ao salvar no Supabase', error);
            } else {
                logger.info('Conteúdo salvo no Supabase');
            }
        } catch (dbError) {
            logger.error('Database error:', dbError);
        }

        res.json({ 
            content: generatedContent,
            tokens: data.usage?.total_tokens,
            template: template
        });
        
    } catch (error) {
        logger.error('Erro ao gerar conteúdo', error);
        res.status(500).json({ error: 'Erro ao gerar conteúdo' });
    }
});

// ✅ FUNÇÕES AUXILIARES PARA MELHOR QUALIDADE

function getSystemMessage(template) {
    const messages = {
        instagram: `Você é um expert em marketing para Instagram. Sua missão é criar legendas que:
- Gerem MÁXIMO engajamento (likes, comentários, saves)
- Usem storytelling autêntico
- Incluam emojis estratégicos e 3-5 hashtags relevantes
- Tenham chamadas para ação claras
- Sejam em português do Brasil, natural e conversacional
NUNCA use clichês como "Não perca essa oportunidade"`,

        facebook: `Você é um copywriter especialista em Facebook Ads. Sua missão:
- Criar anúncios que CONVERTEM (cliques e vendas)
- Usar fórmulas comprovadas: PAS, AIDA, Problema-Solução
- Incluir urgência e escassez quando apropriado
- CTAs claras e diretas
- Texto persuasivo mas não agressivo
Formato EXATO: Título + Texto + CTA`,

        ecommerce: `Você é um expert em copy para e-commerce. Foque em:
- Benefícios (não só características)
- Resolução de dores do cliente
- Construção de confiança e autoridade
- Diferenciais competitivos
- Garantias e social proof
Estrutura: Título atrativo → Descrição persuasiva → Features → CTA`,

        email: `Você é um especialista em email marketing. Regras:
- Assuntos com menos de 60 caracteres e curiosidade
- Saudação personalizável
- Conteúdo com valor real
- CTAs claras e múltiplas
- Tom adequado ao público
- Fechamento profissional`,

        blog: `Você é um expert em SEO e titulação. Crie títulos que:
- Gerem curiosidade e cliques
- Usem números, perguntas, "Como", "Por que"
- Sejam específicos e com benefício claro
- Otimizados para mecanismos de busca
- Diferentes abordagens (lista, guia, pergunta, etc)`,

        google: `Você é um especialista em Google Ads. Foque em:
- Títulos dentro do limite de caracteres
- Palavras-chave estratégicas
- Diferenciais únicos
- CTAs urgentes e diretas
- Maximizar CTR (Taxa de Clique)`
    };
    
    return messages[template] || "Você é um especialista em copywriting. Gere conteúdo persuasivo em português do Brasil.";
}

function buildEnhancedPrompt(userPrompt, template, context = {}) {
    const basePrompts = {
        instagram: `Crie 3 opções de legenda para Instagram sobre: "${userPrompt}"
        
CONTEXTO ADICIONAL:
- Público: ${context.targetAudience || 'geral'}
- Tom: ${context.tone || 'conversacional'} 
- Objetivo: ${context.objective || 'engajamento'}

DIRETRIZES:
1. Primeira opção: storytelling emocional
2. Segunda opção: educativo/informativo  
3. Terceira opção: direta/persuasiva
4. Incluir emojis estratégicos
5. 3-5 hashtags relevantes no final
6. Chamada para ação clara

NÃO numere as opções, apenas apresente as 3 legendas.`,

        facebook: `Crie um anúncio para Facebook Ads sobre: "${userPrompt}"

CONTEXTO:
- Público: ${context.targetAudience || 'Não especificado'}
- Diferencial: ${context.keyFeatures || 'Não especificado'}
- Objetivo: ${context.objective || 'vendas'}

FORMATO EXATO:
Título: [Título impactante - até 40 caracteres]
Texto: [Texto persuasivo - até 150 caracteres]
CTA: [Chamada para ação clara]`,

        ecommerce: `Crie uma descrição de produto para e-commerce: "${userPrompt}"

CONTEXTO:
- Preço: ${context.productPrice || 'Não informado'}
- Características: ${context.keyFeatures || 'Não especificadas'}
- Público: ${context.targetAudience || 'geral'}

ESTRUTURA:
- Título atrativo
- Descrição focada em BENEFÍCIOS
- Lista de características principais
- Elementos de confiança (garantia, reviews)
- CTA para compra`,

        email: `Crie um email de marketing sobre: "${userPrompt}"

CONTEXTO:
- Tipo: ${context.emailType || 'marketing'}
- Público: ${context.targetAudience || 'clientes'}
- Objetivo: ${context.objective || 'engajamento'}

FORMATO:
Assunto: [Assunto persuasivo - até 60 caracteres]
Corpo: [Saudação + Conteúdo principal + CTA + Assinatura]`,

        blog: `Gere 5 títulos atraentes para blog post: "${userPrompt}"

CONTEXTO:
- Abordagem: ${context.approach || 'variada'}
- Foco SEO: ${context.seoFocus || 'sim'}
- Público: ${context.targetAudience || 'geral'}

DIVERSIDADE:
1. Título com números
2. Título com pergunta
3. Título "Como fazer"
4. Título com benefício claro
5. Título urgente/curioso`,

        google: `Crie um anúncio para Google Ads: "${userPrompt}"

CONTEXTO:
- Palavras-chave: ${context.keywords || 'Não especificadas'}
- Diferencial: ${context.keyFeatures || 'Não especificado'}
- Público: ${context.targetAudience || 'geral'}

FORMATO EXATO:
Título 1: [até 30 caracteres]
Título 2: [até 30 caracteres]  
Descrição: [até 90 caracteres]
Path: [categoria/produto]`
    };

    return basePrompts[template] || userPrompt;
}

function getTemperature(template) {
    // Temperaturas específicas por tipo de conteúdo
    const temps = {
        instagram: 0.8,    // Mais criativo
        facebook: 0.7,     // Balanceado
        ecommerce: 0.6,    // Mais consistente
        email: 0.7,        // Balanceado
        blog: 0.9,         // Muito criativo para títulos
        google: 0.5        // Muito consistente (limites rigorosos)
    };
    return temps[template] || 0.7;
}

function postProcessContent(content, template) {
    // Limpeza e formatação pós-geração
    let processed = content
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove **bold** markdown
        .replace(/\n{3,}/g, '\n\n')      // Remove múltiplas quebras de linha
        .trim();

    // Validações específicas por template
    if (template === 'google') {
        // Garantir que atende limites do Google Ads
        const lines = processed.split('\n');
        if (lines.length >= 3) {
            const title1 = lines[0].replace('Título 1:', '').trim();
            const title2 = lines[1].replace('Título 2:', '').trim();
            const description = lines[2].replace('Descrição:', '').trim();
            
            if (title1.length > 30) processed = `Título 1: ${title1.substring(0,30)}\n${lines.slice(1).join('\n')}`;
            if (title2.length > 30) processed = `${lines[0]}\nTítulo 2: ${title2.substring(0,30)}\n${lines.slice(2).join('\n')}`;
            if (description.length > 90) processed = `${lines[0]}\n${lines[1]}\nDescrição: ${description.substring(0,90)}`;
        }
    }

    return processed;
}



// ✅ MELHORADO: Rota para buscar histórico com rate limiting
app.get('/api/history', rateLimit, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('generated_content')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            logger.error('Erro ao buscar histórico', error);
            throw error;
        }
        
        logger.info('Histórico buscado com sucesso', { count: data?.length || 0 });
        res.json(data);
    } catch (error) {
        logger.error('History error:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

// ✅ MELHORADO: Rota para Webhook da Hotmart com logging
app.post('/webhook/hotmart', async (req, res) => {
    try {
        logger.info('🔔 Webhook Hotmart recebido', { 
            event: req.body?.event,
            data: req.body?.data 
        });
        
        const { event, data } = req.body;
        
        // Verificar assinatura (opcional mas recomendado)
        const signature = req.headers['hotmart-hottok'];
        logger.info('📝 Assinatura do webhook', { signature });
        
        // Processar diferentes tipos de eventos
        switch (event) {
            case 'PURCHASE_APPROVED':
                await handlePurchaseApproved(data);
                break;
                
            case 'PURCHASE_COMPLETE':
                await handlePurchaseComplete(data);
                break;
                
            case 'PURCHASE_CANCELED':
                await handlePurchaseCanceled(data);
                break;
                
            case 'PURCHASE_REFUNDED':
                await handlePurchaseRefunded(data);
                break;
                
            case 'PURCHASE_CHARGEBACK':
                await handlePurchaseChargeback(data);
                break;
                
            default:
                logger.warn(`Evento não tratado: ${event}`);
        }
        
        // Sempre retornar 200 para confirmar recebimento
        res.status(200).json({ 
            status: 'success', 
            message: 'Webhook processed successfully' 
        });
        
    } catch (error) {
        logger.error('❌ Erro no webhook:', error);
        res.status(200).json({ // ⭐⭐ SEMPRE retorne 200 mesmo com erro
            status: 'error', 
            message: error.message 
        });
    }
});

// ✅ MELHORADO: Funções para processar os eventos com logging
async function handlePurchaseApproved(data) {
    logger.info('💰 Compra aprovada', { 
        buyer: data.buyer?.email,
        product: data.product?.name 
    });
    
    const { buyer, product, purchase } = data;
    
    try {
        // Ativar trial ou assinatura no Supabase
        const { data: userData, error } = await supabase
            .from('user_subscriptions')
            .upsert({
                user_email: buyer.email,
                product_id: product.id,
                product_name: product.name,
                purchase_token: purchase.transaction,
                status: 'active',
                starts_at: new Date().toISOString(),
                ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 dias
                created_at: new Date().toISOString()
            }, {
                onConflict: 'user_email'
            });

        if (error) {
            logger.error('❌ Erro ao salvar subscription:', error);
        } else {
            logger.info('✅ Subscription salva no Supabase', { userEmail: buyer.email });
        }
        
    } catch (error) {
        logger.error('❌ Erro no handlePurchaseApproved:', error);
    }
}

async function handlePurchaseComplete(data) {
    logger.info('🎉 Compra completada', { 
        buyer: data.buyer?.email,
        product: data.product?.name 
    });
    // Aqui você pode enviar email de boas-vindas, etc.
}

async function handlePurchaseCanceled(data) {
    logger.info('❌ Compra cancelada', { 
        buyer: data.buyer?.email 
    });
    
    const { buyer } = data;
    
    try {
        // Desativar assinatura no Supabase
        const { error } = await supabase
            .from('user_subscriptions')
            .update({
                status: 'canceled',
                canceled_at: new Date().toISOString()
            })
            .eq('user_email', buyer.email);

        if (error) {
            logger.error('❌ Erro ao cancelar subscription:', error);
        } else {
            logger.info('✅ Subscription cancelada no Supabase', { userEmail: buyer.email });
        }
        
    } catch (error) {
        logger.error('❌ Erro no handlePurchaseCanceled:', error);
    }
}

async function handlePurchaseRefunded(data) {
    logger.info('💸 Compra reembolsada', { 
        buyer: data.buyer?.email 
    });
    
    const { buyer } = data;
    
    try {
        // Marcar como reembolsado no Supabase
        const { error } = await supabase
            .from('user_subscriptions')
            .update({
                status: 'refunded',
                refunded_at: new Date().toISOString()
            })
            .eq('user_email', buyer.email);

        if (error) {
            logger.error('❌ Erro ao marcar como refunded:', error);
        } else {
            logger.info('✅ Subscription marcada como refunded', { userEmail: buyer.email });
        }
        
    } catch (error) {
        logger.error('❌ Erro no handlePurchaseRefunded:', error);
    }
}

async function handlePurchaseChargeback(data) {
    logger.info('⚡ Chargeback realizado', { 
        buyer: data.buyer?.email 
    });
    
    const { buyer } = data;
    
    try {
        // Marcar como chargeback no Supabase
        const { error } = await supabase
            .from('user_subscriptions')
            .update({
                status: 'chargeback',
                chargeback_at: new Date().toISOString()
            })
            .eq('user_email', buyer.email);

        if (error) {
            logger.error('❌ Erro ao marcar chargeback:', error);
        } else {
            logger.info('✅ Subscription marcada como chargeback', { userEmail: buyer.email });
        }
        
    } catch (error) {
        logger.error('❌ Erro no handlePurchaseChargeback:', error);
    }
}

// ✅ MELHORADO: Rota para verificar status de assinatura
app.get('/api/subscription/:email', rateLimit, async (req, res) => {
    try {
        const { email } = req.params;
        
        logger.info('Buscando subscription', { email });
        
        const { data, error } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('user_email', email)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                logger.info('Subscription não encontrada', { email });
                return res.status(404).json({ 
                    status: 'not_found',
                    message: 'Assinatura não encontrada' 
                });
            }
            logger.error('Erro ao buscar subscription', error);
            throw error;
        }
        
        logger.info('Subscription encontrada', { 
            email, 
            status: data?.status 
        });
        
        res.json(data);
        
    } catch (error) {
        logger.error('❌ Erro ao buscar subscription:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// ✅ MELHORADO: Health check
app.get('/health', async (req, res) => {
    const healthCheck = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        supabase: 'Unknown'
    };
    
    try {
        // Testar conexão com Supabase
        const { error } = await supabase.from('user_trials').select('count').limit(1);
        healthCheck.supabase = error ? 'Error' : 'Connected';
        
        if (error) {
            healthCheck.status = 'Degraded';
            healthCheck.supabaseError = error.message;
            logger.warn('Health check: Supabase com problemas', { error: error.message });
        } else {
            logger.info('Health check: Todos os sistemas operando');
        }
    } catch (error) {
        healthCheck.status = 'Error';
        healthCheck.supabase = 'Connection Failed';
        logger.error('Health check: Erro na conexão com Supabase', error);
    }
    
    const statusCode = healthCheck.status === 'OK' ? 200 : 
                      healthCheck.status === 'Degraded' ? 200 : 500;
    
    res.status(statusCode).json(healthCheck);
});

// ✅ NOVO: Rota para estatísticas (opcional)
app.get('/api/stats', rateLimit, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('generated_content')
            .select('template_type, created_at')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Últimos 7 dias

        if (error) throw error;
        
        const stats = {
            total: data?.length || 0,
            byTemplate: {},
            last7Days: data?.length || 0
        };
        
        // Agrupar por template
        data?.forEach(item => {
            stats.byTemplate[item.template_type] = (stats.byTemplate[item.template_type] || 0) + 1;
        });
        
        logger.info('Estatísticas geradas', { total: stats.total });
        res.json(stats);
        
    } catch (error) {
        logger.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// ✅ NOVO: Middleware de erro global
app.use((error, req, res, next) => {
    logger.error('Erro não tratado:', error);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        requestId: Date.now()
    });
});

// ✅ NOVO: Rota 404 para rotas não encontradas
app.use('*', (req, res) => {
    logger.warn('Rota não encontrada', { 
        path: req.originalUrl,
        method: req.method 
    });
    res.status(404).json({ 
        error: 'Rota não encontrada',
        path: req.originalUrl
    });
});

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Supabase URL: ${supabaseUrl ? 'Configured' : 'Not configured'}`);
    logger.info(`Rate limiting: Ativo (50 req/15min por IP)`);
});


