
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createUserWithEmailAndPassword, deleteUser, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc, getDocs, query, where } from "firebase/firestore";
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { AlertTriangle, CalendarIcon } from 'lucide-react';

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { cn } from '@/lib/utils';
import { useI18n } from "@/contexts/i18n-context";
import { usersCollection, barriosCollection, organizacionesCollection } from "@/lib/collections";
import { ROLE_LIMITS, normalizeRole } from "@/lib/roles";

const createRegisterSchema = (t: (key: string, params?: Record<string, string | number>) => string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, { message: t('register.validation.nameRequired') })
      .min(2, { message: t('register.validation.nameMin') }),
    email: z
      .string()
      .trim()
      .min(1, { message: t('register.validation.emailRequired') })
      .email({ message: t('register.validation.email') }),
    birthDate: z.date().optional(),
    barrio: z.string().min(1, { message: t('register.validation.barrioRequired') }),
    organizacion: z.string().min(1, { message: t('register.validation.organizacionRequired') }),
    password: z
      .string()
      .min(1, { message: t('register.validation.passwordRequired') })
      .min(6, { message: t('register.validation.passwordMin') }),
    confirmPassword: z
      .string()
      .min(1, { message: t('register.validation.confirmPasswordRequired') }),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t('register.validation.passwordMismatch'),
    path: ["confirmPassword"],
  });


type CapacityState = {
  count: number;
  limit: number;
  remaining: number;
  full: boolean;
  loading: boolean;
};

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const [barrios, setBarrios] = useState<string[]>([]);
  const [organizaciones, setOrganizaciones] = useState<string[]>([]);
  const [capacity, setCapacity] = useState<CapacityState>({
    count: 0,
    limit: ROLE_LIMITS.user,
    remaining: ROLE_LIMITS.user,
    full: false,
    loading: true,
  });

  const form = useForm<z.infer<ReturnType<typeof createRegisterSchema>>>({
    resolver: zodResolver(createRegisterSchema(t)),
    mode: "onTouched",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      barrio: "Libertad",
      organizacion: "Quórum de Élderes",
    },
  });

  const watchedBarrio = form.watch("barrio");
  const watchedOrganizacion = form.watch("organizacion");

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [barriosSnap, orgsSnap] = await Promise.all([
          getDocs(barriosCollection),
          getDocs(organizacionesCollection),
        ]);
        const dbBarrios = barriosSnap.docs.map(d => d.data().name).filter(Boolean);
        const dbOrgs = orgsSnap.docs.map(d => d.data().name).filter(Boolean);
        if (!dbBarrios.includes("Libertad")) dbBarrios.unshift("Libertad");
        if (!dbOrgs.includes("Quórum de Élderes")) dbOrgs.unshift("Quórum de Élderes");
        setBarrios(dbBarrios);
        setOrganizaciones(dbOrgs);
      } catch (err) {
        console.error("Error fetching barrios/organizaciones:", err);
        setBarrios(["Libertad"]);
        setOrganizaciones(["Quórum de Élderes"]);
      }
    };
    fetchOptions();
  }, []);

  useEffect(() => {
    if (!watchedBarrio || !watchedOrganizacion) return;

    let cancelled = false;
    const checkCapacity = async () => {
      setCapacity((prev) => ({ ...prev, loading: true }));
      try {
        const params = new URLSearchParams({
          barrio: watchedBarrio,
          organizacion: watchedOrganizacion,
        });
        const res = await fetch(`/api/auth/registration-capacity?${params.toString()}`);
        if (!res.ok) throw new Error("capacity-check-failed");
        const data = (await res.json()) as {
          count: number;
          limit: number;
          remaining: number;
          full: boolean;
        };
        if (!cancelled) {
          setCapacity({
            count: data.count,
            limit: data.limit,
            remaining: data.remaining,
            full: data.full,
            loading: false,
          });
        }
      } catch (err) {
        console.error("Error checking registration capacity:", err);
        if (!cancelled) {
          // Fail open on check errors; hard limit still applied on submit.
          setCapacity((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    void checkCapacity();
    return () => {
      cancelled = true;
    };
  }, [watchedBarrio, watchedOrganizacion]);

  const countMemberSeats = async (barrioOrg: string): Promise<number> => {
    const snap = await getDocs(
      query(usersCollection, where("barrioOrg", "==", barrioOrg))
    );
    let count = 0;
    snap.forEach((d) => {
      if (normalizeRole(d.data().role) === "user") count += 1;
    });
    return count;
  };

  const onSubmit = async (values: z.infer<ReturnType<typeof createRegisterSchema>>) => {
    if (capacity.full) {
      toast({
        title: t("register.capacity.fullTitle"),
        description: t("register.capacity.fullDescription", {
          limit: capacity.limit,
          barrio: values.barrio,
          organizacion: values.organizacion,
        }),
        variant: "destructive",
      });
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;

      await updateProfile(user, {
          displayName: values.name
      });

      const barrioOrg = `${values.barrio}|${values.organizacion}`;

      // Re-check after auth (user is signed in) to avoid racing past the public API.
      try {
        const memberCount = await countMemberSeats(barrioOrg);
        if (memberCount >= ROLE_LIMITS.user) {
          await deleteUser(user);
          setCapacity({
            count: memberCount,
            limit: ROLE_LIMITS.user,
            remaining: 0,
            full: true,
            loading: false,
          });
          toast({
            title: t("register.capacity.fullTitle"),
            description: t("register.capacity.fullDescription", {
              limit: ROLE_LIMITS.user,
              barrio: values.barrio,
              organizacion: values.organizacion,
            }),
            variant: "destructive",
          });
          return;
        }
      } catch (capacityErr) {
        console.error("Post-auth capacity check failed:", capacityErr);
        // If we cannot verify seats, do not create a user doc with an unknown slot.
        try {
          await deleteUser(user);
        } catch {
          /* ignore cleanup errors */
        }
        toast({
          title: t("register.toastErrorTitle"),
          description: t("register.toastErrorUnexpected"),
          variant: "destructive",
        });
        return;
      }

      const userDocRef = doc(usersCollection, user.uid);
      await setDoc(userDocRef, {
        uid: user.uid,
        name: values.name,
        email: values.email,
        birthDate: values.birthDate ?? null,
        barrio: values.barrio,
        organizacion: values.organizacion,
        barrioOrg,
        role: 'user',
        permission: 'read',
        createdAt: serverTimestamp(),
      });


      toast({
        title: t('register.toastSuccessTitle'),
        description: t('register.toastSuccessDescription'),
      });
      router.push("/login");
    } catch (error: any) {
        console.error("Registration Error:", error);
        let description = t('register.toastErrorUnexpected');
        if (error.code === 'auth/email-already-in-use') {
            description = t('register.toastErrorEmailInUse');
        }
        toast({
            title: t('register.toastErrorTitle'),
            description: description,
            variant: "destructive",
        });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('register.title')}</CardTitle>
        <CardDescription>
          {t('register.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {capacity.full && !capacity.loading && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("register.capacity.fullTitle")}</AlertTitle>
            <AlertDescription>
              {t("register.capacity.fullDescription", {
                limit: capacity.limit,
                barrio: watchedBarrio,
                organizacion: watchedOrganizacion,
              })}
            </AlertDescription>
          </Alert>
        )}
        {!capacity.full && !capacity.loading && capacity.remaining <= 2 && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("register.capacity.lowTitle")}</AlertTitle>
            <AlertDescription>
              {t("register.capacity.lowDescription", {
                remaining: capacity.remaining,
                limit: capacity.limit,
              })}
            </AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('register.nameLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} disabled={capacity.full} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('register.emailLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="m@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="birthDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>
                    {t('register.birthDateLabel')}{" "}
                    <span className="text-muted-foreground text-sm font-normal">
                      ({t('register.optional')})
                    </span>
                  </FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={'outline'}
                          className={cn(
                            'w-full pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? (
                            format(field.value, 'd LLLL yyyy', { locale: getDateFnsLocale() })
                          ) : (
                            <span>{t('register.birthDatePlaceholder')}</span>
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
                        disabled={(date) =>
                          date > new Date() || date < new Date('1900-01-01')
                        }
                        autoFocus
                        locale={getDateFnsLocale()}
                        captionLayout="dropdown"
                        startMonth={new Date(1920, 0)}
                        endMonth={new Date(new Date().getFullYear(), 11)}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="barrio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('register.barrioLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('register.barrioPlaceholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {barrios.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="organizacion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('register.organizacionLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('register.organizacionPlaceholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {organizaciones.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('register.passwordLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('register.confirmPasswordLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting || capacity.full || capacity.loading}
            >
              {form.formState.isSubmitting
                ? t('register.submitButtonLoading')
                : capacity.full
                  ? t('register.capacity.submitDisabled')
                  : t('register.submitButton')}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-center text-sm">
          {t('register.haveAccount')}{" "}
          <Link href="/login" className="underline">
            {t('register.loginLink')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
