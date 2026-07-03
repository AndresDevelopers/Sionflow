
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/contexts/i18n-context";

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  password: z
    .string()
    .min(1, { message: "Password is required." }),
});

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      await signInWithEmailAndPassword(auth, values.email, values.password);
      toast({
          title: t('login.toastSuccessTitle'),
          description: t('login.toastSuccessDescription'),
      });
      router.push("/");
    } catch (error: any) {
      console.error("Login Error:", error);
      
      let description = t('login.toastErrorUnexpected');
      
      // Manejo específico de errores de Firebase
      switch (error.code) {
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          description = t('login.toastErrorInvalidCredentials');
          break;
        case 'auth/user-disabled':
          description = t('login.toastErrorUserDisabled');
          break;
        case 'auth/too-many-requests':
          description = t('login.toastErrorTooManyRequests');
          break;
        case 'auth/network-request-failed':
          description = t('login.toastErrorNetwork');
          break;
        case 'auth/invalid-email':
          description = t('login.toastErrorInvalidEmail');
          break;
        default:
          description = t('login.toastErrorUnexpected');
      }
      
      toast({
        title: t('login.toastErrorTitle'),
        description: description,
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('login.title')}</CardTitle>
        <CardDescription>
          {t('login.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('login.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder="m@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center">
                    <FormLabel>{t('login.passwordLabel')}</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="ml-auto inline-block text-sm underline"
                    >
                      {t('login.forgotPassword')}
                    </Link>
                  </div>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('login.submitButtonLoading') : t('login.submitButton')}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-center text-sm">
          {t('login.noAccount')}{" "}
          <Link href="/register" className="underline">
            {t('login.registerLink')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
