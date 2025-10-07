const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// Rota para gerar conteúdo via DeepSeek
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, template } = req.body;

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
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const generatedContent = data.choices[0].message.content;

        // ⭐⭐ NOVO: Salvar no Supabase ⭐⭐
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
                console.error('Supabase error:', error);
            } else {
                console.log('Saved to Supabase:', dbData);
            }
        } catch (dbError) {
            console.error('Database error:', dbError);
        }

        res.json({ content: generatedContent });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Erro ao gerar conteúdo' });
    }
});

// ⭐⭐ NOVO: Rota para buscar histórico ⭐⭐
app.get('/api/history', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('generated_content')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        
        res.json(data);
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

// ⭐⭐ ADICIONE ESTAS LINHAS AO SEU ARQUIVO BACKEND ⭐⭐

// Rota para Webhook da Hotmart
app.post('/webhook/hotmart', async (req, res) => {
    try {
        console.log('🔔 Webhook Hotmart recebido:', JSON.stringify(req.body, null, 2));
        
        const { event, data } = req.body;
        
        // Verificar assinatura (opcional mas recomendado)
        const signature = req.headers['hotmart-hottok'];
        console.log('📝 Assinatura do webhook:', signature);
        
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
                console.log(`📝 Evento não tratado: ${event}`);
        }
        
        // Sempre retornar 200 para confirmar recebimento
        res.status(200).json({ 
            status: 'success', 
            message: 'Webhook processed successfully' 
        });
        
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(200).json({ // ⭐⭐ SEMPRE retorne 200 mesmo com erro
            status: 'error', 
            message: error.message 
        });
    }
});

// Funções para processar os eventos
async function handlePurchaseApproved(data) {
    console.log('💰 Compra aprovada:', data);
    
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
            console.error('❌ Erro ao salvar subscription:', error);
        } else {
            console.log('✅ Subscription salva no Supabase:', userData);
        }
        
    } catch (error) {
        console.error('❌ Erro no handlePurchaseApproved:', error);
    }
}

async function handlePurchaseComplete(data) {
    console.log('🎉 Compra completada:', data);
    // Aqui você pode enviar email de boas-vindas, etc.
}

async function handlePurchaseCanceled(data) {
    console.log('❌ Compra cancelada:', data);
    
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
            console.error('❌ Erro ao cancelar subscription:', error);
        } else {
            console.log('✅ Subscription cancelada no Supabase');
        }
        
    } catch (error) {
        console.error('❌ Erro no handlePurchaseCanceled:', error);
    }
}

async function handlePurchaseRefunded(data) {
    console.log('💸 Compra reembolsada:', data);
    
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
            console.error('❌ Erro ao marcar como refunded:', error);
        } else {
            console.log('✅ Subscription marcada como refunded');
        }
        
    } catch (error) {
        console.error('❌ Erro no handlePurchaseRefunded:', error);
    }
}

async function handlePurchaseChargeback(data) {
    console.log('⚡ Chargeback realizado:', data);
    
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
            console.error('❌ Erro ao marcar chargeback:', error);
        } else {
            console.log('✅ Subscription marcada como chargeback');
        }
        
    } catch (error) {
        console.error('❌ Erro no handlePurchaseChargeback:', error);
    }
}

// ⭐⭐ Rota para verificar status de assinatura ⭐⭐
app.get('/api/subscription/:email', async (req, res) => {
    try {
        const { email } = req.params;
        
        const { data, error } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('user_email', email)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) {
            return res.status(404).json({ 
                status: 'not_found',
                message: 'Assinatura não encontrada' 
            });
        }
        
        res.json(data);
        
    } catch (error) {
        console.error('❌ Erro ao buscar subscription:', error);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'CopyCraft Backend running',
        supabase: supabaseUrl ? 'Connected' : 'Not configured'
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Supabase URL: ${supabaseUrl ? 'Configured' : 'Not configured'}`);
});

