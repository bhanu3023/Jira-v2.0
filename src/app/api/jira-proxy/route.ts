import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { jiraUrl, email, apiToken, endpoint, method = 'GET', body } = await req.json();

    if (!jiraUrl || !email || !apiToken || !endpoint) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const baseUrl = jiraUrl.replace(/\/$/, '').replace(/\/jira$/, '');
    // Rewrite deprecated /search → /search/jql automatically
    const fixedEndpoint = endpoint.replace(/^\/search(\?|$)/, '/search/jql$1');
    const url = `${baseUrl}/rest/api/3${fixedEndpoint}`;
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Proxy error' }, { status: 500 });
  }
}
