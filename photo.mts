import { isBanned } from './lib/moderation.mjs';
import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';

export default async (req: Request) => {
  const user = await getUser();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!user) return new Response(null, { status: 401, headers });
  if (new URL(req.url).searchParams.get('owner') !== user.id) return new Response(null, { status: 403, headers });
  if (await isBanned(user.id)) return new Response(null, { status: 403, headers });
  const store = getStore({ name: 'wardrobe-images', consistency: 'strong' });
  const key = new URL(req.url).searchParams.get('key');
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return new Response(null, { status: 400, headers });
  const path = `${user.id}/${key}`;
  if (req.method === 'PUT') {
    if (new URL(req.url).origin !== req.headers.get('origin')) return new Response(null, { status: 403, headers });
    const data = await req.text();
    if (data.length > 1_500_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) return new Response(null, { status: 400, headers });
    await store.set(path, data);
    return Response.json({ ok: true }, { headers });
  }
  if (req.method !== 'GET') return new Response(null, { status: 405, headers });
  const data = await store.get(path);
  return data ? Response.json({ data }, { headers }) : new Response(null, { status: 404, headers });
};
