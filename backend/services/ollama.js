const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3:mini';

const TAG_TAXONOMY = [
  'prompting', 'ai-tools', 'llm', 'chatgpt', 'productivity',
  'marketing', 'content-strategy', 'seo', 'copywriting', 'branding',
  'research', 'data', 'statistics', 'case-study', 'report',
  'career', 'job-search', 'networking', 'leadership', 'management',
  'startup', 'entrepreneurship', 'funding', 'business-model',
  'personal-finance', 'investing', 'savings', 'money',
  'coding', 'web-dev', 'android', 'open-source', 'devtools',
  'design', 'ux', 'visual', 'typography',
  'motivation', 'mindset', 'habits', 'self-improvement',
  'video', 'tutorial', 'thread', 'infographic', 'tool',
  'anti-consumerism', 'sustainability', 'minimalism',
  'bangladesh', 'finland', 'community',
  'funny', 'viral', 'interesting', 'must-read'
];

function ollamaRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // Ollama streams line-delimited JSON; collect the last response
          const lines = data.trim().split('\n');
          let fullResponse = '';
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed.response) fullResponse += parsed.response;
            if (parsed.done) break;
          }
          resolve(fullResponse);
        } catch (e) {
          reject(new Error('Ollama parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Ollama request timed out after 60s'));
    });
    req.write(body);
    req.end();
  });
}

async function analyzePost(content, authorName) {
  const contentSnippet = content.slice(0, 1500);
  const availableTags = TAG_TAXONOMY.join(', ');

  const prompt = `You are a content librarian. Analyze this LinkedIn post and return ONLY a valid JSON object, nothing else.

POST AUTHOR: ${authorName || 'Unknown'}
POST CONTENT:
${contentSnippet}

AVAILABLE HASHTAGS (pick 2-5 most relevant): ${availableTags}

Return this exact JSON structure:
{
  "tags": ["tag1", "tag2"],
  "topics": ["Main topic in 3-5 words", "Secondary topic in 3-5 words"],
  "one_liner": "One sentence summary of the post",
  "key_points": "2-3 bullet points of main takeaways, separated by | character",
  "post_type": "article|video|tip|research|motivation|funny|thread|tool|other",
  "why_saved": "One sentence on why this is worth saving"
}

Return ONLY the JSON. No explanation. No markdown. No extra text.`;

  try {
    const raw = await ollamaRequest({
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_predict: 400
      }
    });

    // Extract JSON from response (handle cases where model adds text)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in model response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and sanitize
    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(t => TAG_TAXONOMY.includes(t)).slice(0, 6) : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 4) : [],
      one_liner: typeof parsed.one_liner === 'string' ? parsed.one_liner.slice(0, 200) : '',
      key_points: typeof parsed.key_points === 'string' ? parsed.key_points : '',
      post_type: parsed.post_type || 'post',
      why_saved: typeof parsed.why_saved === 'string' ? parsed.why_saved.slice(0, 200) : ''
    };
  } catch (err) {
    console.error('AI analysis failed, falling back to keyword extraction:', err.message);
    return fallbackAnalysis(content);
  }
}

function fallbackAnalysis(content) {
  const lower = content.toLowerCase();
  const tags = TAG_TAXONOMY.filter(tag => {
    const keyword = tag.replace(/-/g, ' ');
    return lower.includes(keyword) || lower.includes(tag);
  }).slice(0, 4);

  return {
    tags: tags.length ? tags : ['interesting'],
    topics: ['Content from LinkedIn'],
    one_liner: content.slice(0, 120) + '...',
    key_points: '',
    post_type: 'post',
    why_saved: 'Manually saved from LinkedIn'
  };
}

async function checkOllama() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/tags',
      method: 'GET'
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = { analyzePost, checkOllama, TAG_TAXONOMY };
