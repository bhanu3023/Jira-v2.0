import { NextRequest } from 'next/server';
import { handleJiraPgApi } from '@/lib/jira-pg-api';

/** Node runtime: required for Buffer (JWT tokens) and Prisma. */
export const runtime = 'nodejs';

type RouteParams = { params: { path?: string[] } };

function segments(params: { path?: string[] }) {
  return params.path ?? [];
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  return handleJiraPgApi(req, segments(params), 'GET');
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  return handleJiraPgApi(req, segments(params), 'POST');
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  return handleJiraPgApi(req, segments(params), 'PATCH');
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  return handleJiraPgApi(req, segments(params), 'PUT');
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  return handleJiraPgApi(req, segments(params), 'DELETE');
}
