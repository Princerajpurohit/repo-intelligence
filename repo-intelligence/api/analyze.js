const axios = require('axios');

async function fetchGitHubData(owner, repo) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`
  };
  const axiosConfig = { headers, timeout: 10000 };
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoRes, langRes, commitsRes, issuesRes, releasesRes, contribRes] = await Promise.all([
    axios.get(base, axiosConfig),
    axios.get(`${base}/languages`, axiosConfig),
    axios.get(`${base}/commits?per_page=10`, axiosConfig),
    axios.get(`${base}/issues?state=all&per_page=20`, axiosConfig),
    axios.get(`${base}/releases?per_page=5`, axiosConfig),
    axios.get(`${base}/contributors?per_page=10`, axiosConfig).catch(() => ({ data: [] })),
  ]);

  return {
    repo: repoRes.data,
    languages: langRes.data,
    commits: commitsRes.data,
    issues: issuesRes.data,
    releases: releasesRes.data,
    contributors: contribRes.data,
  };
}

async function analyzeWithCerebras(ghData) {
  const r = ghData.repo;
  const langList = Object.keys(ghData.languages).join(', ') || 'Unknown';
  const recentCommits = ghData.commits.slice(0, 10).map(c => c.commit?.message?.split('\n')[0]).join(' | ');
  const openIssues = ghData.issues.filter(i => i.state === 'open').length;
  const closedIssues = ghData.issues.filter(i => i.state === 'closed').length;

  const prompt = `You are an expert technical analyst producing an investor-ready GitHub repository intelligence report.

IMPORTANT: Calculate a UNIQUE investorScore (1-100) based on actual data. Do NOT default to 72. A repo with 100k stars should score 85-95. A repo with 10 stars should score 20-40. Vary the score meaningfully.

Analyze this repository:
- Name: ${r.full_name}
- Description: ${r.description || 'No description'}
- Languages: ${langList}
- Stars: ${r.stargazers_count}, Forks: ${r.forks_count}
- Open issues: ${openIssues}, Closed issues: ${closedIssues}
- Size: ${r.size} KB
- Created: ${r.created_at?.substring(0,10)}, Last pushed: ${r.pushed_at?.substring(0,10)}
- License: ${r.license?.name || 'None'}
- Contributors: ${ghData.contributors.length}+
- Releases: ${ghData.releases.length}
- Recent commits: ${recentCommits}
- Topics: ${(r.topics||[]).join(', ') || 'None'}

Based on ALL the data provided above, respond ONLY with a valid JSON object. No markdown, no backticks, no extra text. Every field must be based on ACTUAL analysis of this specific repository:
{
  "investorScore": <integer 1-100, calculated from: stars(30pts) + commit frequency(20pts) + contributors(15pts) + issue resolution rate(15pts) + license(10pts) + releases(10pts). Be precise and unique per repo>,
  "scoreLabel": <"Exceptional" if >85, "Strong" if 70-85, "Moderate" if 50-69, "Weak" if 30-49, "Poor" if <30>,
  "scoreColor": <"teal" if >75, "green" if 60-75, "amber" if 40-59, "red" if <40>,
  "oneLiner": <one sharp sentence describing exactly what THIS repo does>,
  "verdict": <2-3 sentences of genuine investor analysis based on THIS repo's actual metrics>,
  "badges": <2-4 badges that are TRUE for this repo>,
  "codeQuality": { "score": <"Excellent"/"Good"/"Fair"/"Poor">, "points": <4 specific observations> },
  "security": { "score": <"High"/"Medium"/"Low">, "points": <3 specific observations> },
  "techStack": <actual languages and likely frameworks>,
  "aiInsights": <4 unique data-driven insights specific to THIS repo>,
  "investorSummary": {
    "strengths": <3 genuine strengths>,
    "risks": <2 real risks>,
    "recommendation": <"Buy" if score>75, "Watch" if 50-75, "Pass" if <50 — with specific reason>
  }
}`;

  const response = await axios.post(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      model: 'gpt-oss-120b',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const text = response.data.choices[0].message.content;
  if (!text) throw new Error('Empty response from AI');

  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  try {
    return JSON.parse(jsonMatch[0]);
  } catch(parseErr) {
    throw new Error('JSON parse failed: ' + parseErr.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { owner, repo } = req.body;
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' });

  try {
    const ghData = await fetchGitHubData(owner, repo);
    const aiData = await analyzeWithCerebras(ghData);
    res.json({ github: ghData.repo, ai: aiData });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Something went wrong';
    res.status(500).json({ error: msg });
  }
};