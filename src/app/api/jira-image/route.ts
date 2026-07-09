import { NextRequest, NextResponse } from 'next/server';

const JIRA_BASE_URL = 'https://cf2020.atlassian.net';
const JIRA_EMAIL    = 'sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN    = 'REDACTED_API_TOKEN';
const JIRA_AUTH     = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id  = searchParams.get('id');
  const url = searchParams.get('url'); // direct URL fallback

  try {
    const target = url || (id ? `${JIRA_BASE_URL}/rest/api/3/attachment/content/${id}` : null);
    if (!target) return NextResponse.json({ error: 'Missing id or url' }, { status: 400 });

    const res = await fetch(target, {
      headers: { Authorization: JIRA_AUTH },
      redirect: 'follow',
    });

    if (!res.ok) return new NextResponse(null, { status: res.status });

    const contentType = res.headers.get('content-type') || 'image/png';
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}

