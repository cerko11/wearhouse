import community from './community.mjs';

// Profiles are the existing userProfile documents in Netlify Database, keyed by
// the authenticated account ID so email/username changes retain the same data.
export default async (req: Request) => {
  const url = new URL(req.url);
  url.searchParams.set('profiles', '1');
  return community(new Request(url, req));
};
