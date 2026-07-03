
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getDocs, Timestamp } from 'firebase/firestore';
import { membersCollection } from '@/lib/collections';
import type { Member } from '@/lib/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getFutureMembers } from '@/lib/dashboard-data';
import { buildMemberEditUrl } from '@/lib/navigation';

export default function FutureMembersPage() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const [futureMembers, setFutureMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFutureMembers(barrioOrg);
      setFutureMembers(data);
    } catch (error) {
      console.error("Failed to fetch future members:", error);
    }
    setLoading(false);
  }, [barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return;

    queueMicrotask(() => {
      void loadData();
    });
  }, [authLoading, user, loadData]);



  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{t('futureMembers.title')}</CardTitle>
            <CardDescription>
              {t('futureMembers.description')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('futureMembers.name')}</TableHead>
              <TableHead>{t('futureMembers.baptismDate')}</TableHead>
              <TableHead className="text-right">{t('futureMembers.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                   <TableCell>
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <Skeleton className="h-5 w-32" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-8 inline-block" /></TableCell>
                </TableRow>
              ))
            ) : futureMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  {t('futureMembers.noData')}
                </TableCell>
              </TableRow>
            ) : (
              futureMembers.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                     <div className="flex items-center gap-3">
                        <Avatar>
                            <AvatarImage src={item.photoURL} data-ai-hint="profile picture" />
                            <AvatarFallback>{item.firstName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span>{item.firstName} {item.lastName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.baptismDate ? format(item.baptismDate.toDate(), 'd LLLL yyyy', { locale: es }) : 'No especificada'}
                  </TableCell>
                   <TableCell className="text-right">
                     <Button variant="ghost" size="icon" asChild>
                       <Link href={buildMemberEditUrl(item.id, '/future-members')}>
                         <Pencil className="h-4 w-4" />
                       </Link>
                     </Button>
                   </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
