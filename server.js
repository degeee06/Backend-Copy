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
