import { auth } from '@/lib/auth';

export default auth((req) => {
  const isLogin = req.nextUrl.pathname === '/login';
  const isApiAuth = req.nextUrl.pathname.startsWith('/api/auth');
  if (isApiAuth) return;

  if (!req.auth && !isLogin) {
    const url = new URL('/login', req.url);
    return Response.redirect(url);
  }
  if (req.auth && isLogin) {
    return Response.redirect(new URL('/', req.url));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
