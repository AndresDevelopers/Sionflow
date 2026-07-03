
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc, getDocs } from "firebase/firestore";
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';

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
import { useToast } from "@/hooks/use-toast";
import { cn } from '@/lib/utils';
import { useI18n } from "@/contexts/i18n-context";
import { usersCollection, barriosCollection, organizacionesCollection } from "@/lib/collections";

const registerSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Invalid email address." }),
  birthDate: z.date({
    required_error: "Date of birth is required.",
  }),
  barrio: z.string().min(1, { message: "Barrio is required." }),
  organizacion: z.string().min(1, { message: "Organización is required." }),
  password: z
    .string()
    .min(6, { message: "Password must be at least 6 characters." }),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
});


export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const [barrios, setBarrios] = useState<string[]>([]);
  const [organizaciones, setOrganizaciones] = useState<string[]>([]);

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

  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      barrio: "Libertad",
      organizacion: "Quórum de Élderes",
    },
  });

  const onSubmit = async (values: z.infer<typeof registerSchema>) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;
      
      await updateProfile(user, {
          displayName: values.name
      });
      
      const userDocRef = doc(usersCollection, user.uid);
      await setDoc(userDocRef, {
        uid: user.uid,
        name: values.name,
        email: values.email,
        birthDate: values.birthDate,
        barrio: values.barrio,
        organizacion: values.organizacion,
        barrioOrg: `${values.barrio}|${values.organizacion}`,
        role: 'user',
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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('register.nameLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
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
                  <FormLabel>{t('register.emailLabel')}</FormLabel>
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
                  <FormLabel>{t('register.birthDateLabel')}</FormLabel>
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
                            format(field.value, 'd LLLL yyyy', { locale: es })
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
                        locale={es}
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
                  <FormLabel>{t('register.barrioLabel')}</FormLabel>
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
                  <FormLabel>{t('register.organizacionLabel')}</FormLabel>
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
                  <FormLabel>{t('register.passwordLabel')}</FormLabel>
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
                  <FormLabel>{t('register.confirmPasswordLabel')}</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('register.submitButtonLoading') : t('register.submitButton')}
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
