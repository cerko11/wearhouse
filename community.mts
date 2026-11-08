import { isAdminEmail } from './lib/admin.mjs';
import { getUser, admin } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { or, like, eq } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';

// Only explicitly published post fields leave an account's private storage.
export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  const user = await getUser();
  if (!user) return new Response(null, { status: 401, headers });
  if (req.method !== 'GET') return new Response(null, { status: 405, headers });
  try {
    const profilesOnly = new URL(req.url).searchParams.get('profiles') === '1';
    const rows = await drizzle().select().from(accountRecords).where(profilesOnly ? or(eq(accountRecords.key, 'userProfile'), like(accountRecords.key, 'moderation:%')) : or(like(accountRecords.key, 'posts:%'), eq(accountRecords.key, 'userProfile'), eq(accountRecords.key, 'communityReactions'), like(accountRecords.key, 'moderation:%')));
    const moderation = rows.filter(r => r.key.startsWith('moderation:'));
    const status = (id: string) => moderation.find(r => r.userId === id && r.key === 'moderation:account')?.value as any;
    if (status(user.id)?.banned) return new Response(null, { status: 403, headers });
    const removed = (id: string, key: string) => moderation.some(r => r.userId === id && r.key === key && r.value === true);
    const profiles = new Map(rows.filter(r => r.key === 'userProfile' && r.value && !status(r.userId)?.banned).map(r => [r.userId, r.value as any]));
    // Resolve the designated account from Identity, never from editable profile data.
    const automaticVerification = new Set<string>();
    await Promise.all([...profiles.keys()].map(async id => {
      try {
        const account = id === user.id ? user : await admin.getUser(id);
        if (typeof account.email === 'string' && account.email.trim().toLowerCase() === 'cerko11real@gmail.com') automaticVerification.add(id);
      } catch { /* An unavailable/deleted Identity account receives no automatic badge. */ }
    }));
    const reactions = rows.filter(r => r.key === 'communityReactions' && !status(r.userId)?.banned);
    const image = (value: any, owner: string, post: string): string => {
      if (value?.__wearhouseImage) return '/.netlify/functions/community-photo?owner=' + encodeURIComponent(owner) + '&post=' + encodeURIComponent(post) + '&key=' + encodeURIComponent(value.__wearhouseImage);
      return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
    };
    const posts = rows.filter(r => r.key.startsWith('posts:') && r.value && !status(r.userId)?.banned && !removed(r.userId, 'moderation:post:' + r.key.slice(6))).map(r => {
      const p = r.value as any, profile = profiles.get(r.userId), id = r.key.slice(6);
      const reactionKey = r.userId + ':' + id;
      const mine = reactions.find(x => x.userId === user.id)?.value as any;
      const comments = reactions.flatMap(r => {
        const entries = (r.value as any)?.[reactionKey]?.comments;
        if (!Array.isArray(entries)) return [];
        const author = profiles.get(r.userId);
        return entries.filter(c => c && typeof c.id === 'string' && !removed(reactionKey.slice(0, reactionKey.lastIndexOf(':')), 'moderation:comment:' + id + ':' + r.userId + ':' + c.id) && typeof c.text === 'string' && c.text.trim()).slice(-500).map(c => ({ id: r.userId + ':' + c.id, text: c.text.slice(0, 500), createdAt: Number(c.createdAt) || 0, authorId: r.userId, username: author?.username || 'member' }));
      }).sort((a, b) => a.createdAt - b.createdAt);
      return { comments, id, authorId: r.userId, authorName: profile?.name || p.authorName || 'WearHouse member', username: profile?.username || p.username || '', caption: p.caption, style: p.style, tags: p.tags, createdAt: p.createdAt, image: image(p.image, r.userId, id), piecesSnapshot: (p.piecesSnapshot || []).map((i: any) => ({ name: i.name, category: i.category, color: i.color, photo: image(i.photo, r.userId, id) })), likes: reactions.filter(x => (x.value as any)?.[reactionKey]?.liked).length, liked: !!mine?.[reactionKey]?.liked, bookmarked: !!mine?.[reactionKey]?.bookmarked };
    }).sort((a, b) => b.createdAt - a.createdAt);
    const members = [...profiles.entries()].map(([id, p]) => {
      const blocked = (a: any, b: string) => Array.isArray(a?.blockedUsers) && a.blockedUsers.includes(b);
      const following = Array.isArray(p.following) ? [...new Set<string>(p.following.filter((target: any) => typeof target === 'string' && target !== id && profiles.has(target) && !blocked(p, target) && !blocked(profiles.get(target), id)))] : [];
      const avatar = p.avatar?.__wearhouseImage ? '/.netlify/functions/community-photo?owner=' + encodeURIComponent(id) + '&profile=1&key=' + encodeURIComponent(p.avatar.__wearhouseImage) : image(p.avatar, id, '');
      return { id, verified: automaticVerification.has(id) || status(id)?.verified === true, avatar, name: p.name || 'WearHouse member', username: p.username || 'member', bio: typeof p.bio === 'string' ? p.bio.slice(0, 160) : '', wardrobePublic: p.wardrobePublic === true, following };
    });
    if (profilesOnly) return Response.json({ members }, { headers });
    return Response.json({ posts, members, admin: isAdminEmail(user.email), removedComments: moderation.filter(r => r.key.startsWith('moderation:comment:') && r.value === true).map(r => r.userId + ':' + r.key.slice(19)) }, { headers });
  } catch { return Response.json({ error: 'Community is temporarily unavailable.' }, { status: 503, headers }); }
};
