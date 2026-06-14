const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

async function fetchGitHubData(owner, repo) {
 const headers = { 
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`
};
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoRes, langRes, commitsRes, issuesRes, releasesRes, contribRes] = await Promise.all([
    axios.get(base, { headers }),
    axios.get(`${base}/languages`, { headers }),
    axios.get(`${base}/commits?per_page=30`, { headers }),
    axios.get(`${base}/issues?state=all&per_page=50`, { headers }),
    axios.get(`${base}/releases?per_page=5`, { headers }),
    axios.get(`${base}/contributors?per_page=10`, { headers }),
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
  "oneLiner": <one sharp sentence describing exactly what THIS repo does based on its description and topics>,
  "verdict": <2-3 sentences of genuine investor analysis based on THIS repo's actual metrics, community size, and activity>,
  "badges": <2-4 badges that are TRUE for this repo, choose from: "Open Source", "MIT Licensed", "Apache Licensed", "GPL Licensed", "No License", "Highly Active", "Moderate Activity", "Low Activity", "Large Community", "Growing Community", "Solo Project", "Well Documented", "Has Wiki", "Has Releases", "No Releases">,
  "codeQuality": {
    "score": <"Excellent" / "Good" / "Fair" / "Poor" based on commit frequency, issue ratio, repo size>,
    "points": <4 specific observations about THIS repo's code quality based on actual metrics provided>
  },
  "security": {
    "score": <"High" / "Medium" / "Low" based on license presence, issue management, contributor count>,
    "points": <3 specific security observations about THIS repo>
  },
  "techStack": <list of actual languages and likely frameworks detected from languages data and repo topics>,
  "aiInsights": <4 unique, data-driven insights specific to THIS repository's actual numbers and activity>,
  "investorSummary": {
    "strengths": <3 genuine strengths based on THIS repo's actual data>,
    "risks": <2 real risks based on THIS repo's actual weaknesses>,
    "recommendation": <"Buy" if score>75, "Watch" if 50-75, "Pass" if <50 — followed by one specific reason based on this repo's data>
  }
}`;

  const response = await axios.post(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      model: "gpt-oss-120b",
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
console.log('Full Cerebras response:', JSON.stringify(response.data, null, 2));
const text = response.data.choices[0].message.content;
if (!text) throw new Error('Empty response from AI');

const cleaned = text
  .replace(/```json/g, '')
  .replace(/```/g, '')
  .trim();

const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error('AI did not return valid JSON: ' + cleaned.substring(0, 200));

try {
  return JSON.parse(jsonMatch[0]);
} catch(parseErr) {
  console.log('RAW AI RESPONSE:', cleaned);
  throw new Error('JSON parse failed: ' + parseErr.message);
}
}

app.post('/analyze', async (req, res) => {
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
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));