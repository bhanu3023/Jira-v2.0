'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';

export default function Home() {
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const router = useRouter();

  useEffect(() => {
    router.replace(isAuthenticated ? '/dashboard' : '/auth/login');
  }, [isAuthenticated, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  );
}
