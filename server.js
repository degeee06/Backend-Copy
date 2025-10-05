const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

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
        res.json({ content: data.choices[0].message.content });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Erro ao gerar conteúdo' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'CopyCraft Backend running' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});