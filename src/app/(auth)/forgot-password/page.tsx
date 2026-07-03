
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { sendPasswordResetEmail } from "firebase/auth";
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

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();

  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof forgotPasswordSchema>) => {
    try {
      await sendPasswordResetEmail(auth, values.email);
      toast({
        title: t('forgotPassword.toastSuccessTitle'),
        description: t('forgotPassword.toastSuccessDescription'),
      });
      router.push("/login");
    } catch (error: any) {
        console.error("Password Reset Error:", error);
        let description = t('forgotPassword.toastErrorUnexpected');
        if (error.code === 'auth/user-not-found') {
            description = t('forgotPassword.toastErrorUserNotFound');
        }
        toast({
            title: t('forgotPassword.toastErrorTitle'),
            description: description,
            variant: "destructive",
        });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('forgotPassword.title')}</CardTitle>
        <CardDescription>
          {t('forgotPassword.description')}
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
                  <FormLabel>{t('forgotPassword.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder="m@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('forgotPassword.submitButtonLoading') : t('forgotPassword.submitButton')}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-center text-sm">
          {t('forgotPassword.rememberedPassword')}{" "}
          <Link href="/login" className="underline">
            {t('forgotPassword.loginLink')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
