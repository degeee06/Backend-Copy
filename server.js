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

// ✅ MELHORADO: Rota para gerar conteúdo com validações
app.post('/api/generate', rateLimit, validateGenerateRequest, async (req, res) => {
    try {
        const { prompt, template } = req.body;

        logger.info('Gerando conteúdo', { template, promptLength: prompt.length });

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content: "Você é um especialista em copywriting e marketing digital. Gere conteúdo persuasivo e otimizado em português do Brasil."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 1000,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            logger.error('Erro na API DeepSeek', { status: response.status });
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const generatedContent = data.choices[0].message.content;

        logger.info('Conteúdo gerado com sucesso', { 
            contentLength: generatedContent.length,
            template 
        });

        // Salvar no Supabase
        try {
            const { data: dbData, error } = await supabase
                .from('generated_content')
                .insert([
                    {
                        template_type: template,
                        prompt: prompt,
                        content: generatedContent,
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

        res.json({ content: generatedContent });
        
    } catch (error) {
        logger.error('Erro ao gerar conteúdo', error);
        res.status(500).json({ error: 'Erro ao gerar conteúdo' });
    }
});

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
