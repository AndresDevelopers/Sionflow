"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
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
import { Shield } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email({ message: "Correo no válido." }),
  password: z.string().min(1, { message: "La contraseña es obligatoria." }),
});

async function verifyAppAdmin(idToken: string): Promise<boolean> {
  const res = await fetch("/api/app-admin/me", {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { ok?: boolean };
  return data.ok === true;
}

export default function AppAdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setChecking(false);
        return;
      }
      try {
        const token = await user.getIdToken();
        const ok = await verifyAppAdmin(token);
        if (ok) {
          router.replace("/app-admin/panel");
          return;
        }
        setChecking(false);
      } catch {
        setChecking(false);
      }
    });
    return () => unsub();
  }, [router]);

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        values.email.trim(),
        values.password
      );
      const token = await cred.user.getIdToken(true);
      try {
        const { syncServerSession } = await import("@/lib/auth-session-client");
        await syncServerSession(token);
      } catch {
        // non-fatal
      }
      const ok = await verifyAppAdmin(token);

      if (!ok) {
        const { syncServerSession } = await import("@/lib/auth-session-client");
        await syncServerSession(null);
        await signOut(auth);
        toast({
          title: "Acceso denegado",
          description:
            "Esta cuenta no es el admin general de la app. Usa las credenciales de APP_ADMIN_EMAIL.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Sesión de admin general",
        description: "Puedes ver todos los usuarios e ingresar como cualquiera.",
      });
      router.push("/app-admin/panel");
    } catch (error: unknown) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "";

      let description = "No se pudo iniciar sesión.";
      if (
        code === "auth/invalid-credential" ||
        code === "auth/user-not-found" ||
        code === "auth/wrong-password"
      ) {
        description = "Correo o contraseña incorrectos.";
      } else if (code === "auth/too-many-requests") {
        description = "Demasiados intentos. Espera un momento.";
      } else if (code === "auth/network-request-failed") {
        description = "Error de red. Revisa tu conexión.";
      }

      toast({
        title: "Error de login",
        description,
        variant: "destructive",
      });
    }
  };

  if (checking) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Comprobando sesión…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Shield className="h-6 w-6 text-rose-600" />
            Admin general
          </CardTitle>
          <CardDescription>
            Inicia sesión para gestionar la plataforma.
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
                    <FormLabel>Correo</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="username"
                        placeholder="admin@sionflow.app"
                        {...field}
                      />
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
                    <FormLabel>Contraseña</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? "Verificando…"
                  : "Entrar al panel"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
