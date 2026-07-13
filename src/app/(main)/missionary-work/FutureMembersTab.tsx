'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, PlusCircle, CalendarIcon, Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getDateFnsLocale } from '@/lib/i18n-date';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getFutureMembers } from '@/lib/dashboard-data';
import { buildMemberEditUrl } from '@/lib/navigation';
import { createMember, deleteMember } from '@/lib/members-data';
import { Timestamp } from 'firebase/firestore';
import { cn } from '@/lib/utils';

const RETURN_TO = '/missionary-work?tab=future_members';

const createFutureMemberSchema = (t: (key: string) => string) =>
  z.object({
    firstName: z.string().min(1, { message: t('futureMembers.validation.firstNameRequired') }),
    lastName: z.string().min(1, { message: t('futureMembers.validation.lastNameRequired') }),
    baptismDate: z
      .date({
        required_error: t('futureMembers.validation.baptismDateRequired'),
      })
      .refine(
        (date) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return date >= today;
        },
        { message: t('futureMembers.validation.baptismDateFuture') }
      ),
    address: z.string().optional(),
    phoneNumber: z.string().optional(),
  });

type FutureMemberFormValues = z.infer<ReturnType<typeof createFutureMemberSchema>>;

export function FutureMembersTab() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const [futureMembers, setFutureMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { t } = useI18n();
  const { toast } = useToast();

  const schema = useMemo(() => createFutureMemberSchema(t), [t]);

  const form = useForm<FutureMemberFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      baptismDate: undefined,
      address: '',
      phoneNumber: '',
    },
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFutureMembers(barrioOrg);
      setFutureMembers(data);
    } catch (error) {
      console.error('Failed to fetch future members:', error);
    }
    setLoading(false);
  }, [barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return;

    queueMicrotask(() => {
      void loadData();
    });
  }, [authLoading, user, loadData]);

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      form.reset({
        firstName: '',
        lastName: '',
        baptismDate: undefined,
        address: '',
        phoneNumber: '',
      });
    }
  };

  const handleDelete = async (member: Member) => {
    setDeletingId(member.id);
    try {
      await deleteMember(member.id);
      toast({
        title: t('futureMembers.deleteSuccessTitle'),
        description: t('futureMembers.deleteSuccessDescription'),
      });
      await loadData();
    } catch (error) {
      console.error('Error deleting future member:', error);
      toast({
        title: t('futureMembers.deleteErrorTitle'),
        description:
          error instanceof Error
            ? error.message
            : t('futureMembers.deleteErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const onSubmit = async (values: FutureMemberFormValues) => {
    if (!user) {
      toast({
        title: t('common.error'),
        description: t('futureMembers.mustSignIn'),
        variant: 'destructive',
      });
      return;
    }

    if (!barrioOrg) {
      toast({
        title: t('common.error'),
        description: t('futureMembers.saveError'),
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const newMember = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        status: 'active' as const,
        phoneNumber: values.phoneNumber?.trim() || undefined,
        address: values.address?.trim() || undefined,
        baptismDate: Timestamp.fromDate(values.baptismDate),
        ordinances: [] as Member['ordinances'],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: user.uid,
      };

      await createMember(newMember as Omit<Member, 'id'>, barrioOrg);

      toast({
        title: t('futureMembers.addedTitle'),
        description: t('futureMembers.addedDescription'),
      });

      handleDialogOpenChange(false);
      await loadData();
    } catch (error) {
      console.error('Error creating future member:', error);
      toast({
        title: t('common.error'),
        description:
          error instanceof Error ? error.message : t('futureMembers.saveError'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start gap-3">
          <div>
            <CardTitle>{t('futureMembers.title')}</CardTitle>
            <CardDescription>{t('futureMembers.description')}</CardDescription>
          </div>
          {canWrite && (
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t('futureMembers.addMember')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('futureMembers.addTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('futureMembers.addMemberDescription')}
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {t('futureMembers.requiredFieldsHint')}
                    </p>
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('futureMembers.firstName')}{' '}
                            <span className="text-red-600">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('futureMembers.firstNamePlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('futureMembers.lastName')}{' '}
                            <span className="text-red-600">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('futureMembers.lastNamePlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="baptismDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>
                            {t('futureMembers.baptismDate')}{' '}
                            <span className="text-red-600">*</span>
                          </FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={cn(
                                    'w-full pl-3 text-left font-normal',
                                    !field.value && 'text-muted-foreground'
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, 'd LLLL yyyy', {
                                      locale: getDateFnsLocale(),
                                    })
                                  ) : (
                                    <span>{t('futureMembers.selectDate')}</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('futureMembers.address')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('futureMembers.addressPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phoneNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('futureMembers.phone')}</FormLabel>
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder={t('futureMembers.phonePlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDialogOpenChange(false)}
                        disabled={saving}
                      >
                        {t('futureMembers.cancel')}
                      </Button>
                      <Button type="submit" disabled={saving}>
                        {saving ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('futureMembers.saving')}
                          </>
                        ) : (
                          t('futureMembers.save')
                        )}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
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
                  <TableCell>
                    <Skeleton className="h-5 w-24" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-8 w-8 inline-block" />
                  </TableCell>
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
                      <span>
                        {item.firstName} {item.lastName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.baptismDate
                      ? format(item.baptismDate.toDate(), 'd LLLL yyyy', {
                          locale: getDateFnsLocale(),
                        })
                      : t('futureMembers.dateNotSpecified')}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={buildMemberEditUrl(item.id, RETURN_TO)}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t('futureMembers.deleteDialogTitle')}
                              </AlertDialogTitle>
                              <AlertDialogDescription
                                dangerouslySetInnerHTML={{
                                  __html: t('futureMembers.deleteDialogDescription', {
                                    name: `${item.firstName} ${item.lastName}`.trim(),
                                  }),
                                }}
                              />
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t('futureMembers.cancel')}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(item)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                {t('futureMembers.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
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
