'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, PlusCircle, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { doc, getDoc } from 'firebase/firestore';
import { usersCollection } from '@/lib/collections';

interface AnnotationItem {
    id: string;
    description: string;
    isCompleted?: boolean;
    isCouncilAction?: boolean;
    createdAt?: any;
    userId?: string;
}

interface AnnotationManagerProps {
    title: string;
    description: string;
    buttonText: string;
    dialogTitle: string;
    placeholder: string;
    items: AnnotationItem[];
    loading: boolean;
    showCheckbox?: boolean;
    showResolveButton?: boolean;
    onAdd: (description: string) => Promise<void>;
    onToggle?: (id: string, status: boolean) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onResolve?: (id: string) => Promise<void>;
    emptyMessage?: string;
    currentUserId?: string;
}

export function AnnotationManager({
    title,
    description,
    buttonText,
    dialogTitle,
    placeholder,
    items,
    loading,
    showCheckbox = false,
    showResolveButton = false,
    onAdd,
    onToggle,
    onDelete,
    onResolve,
    emptyMessage = 'No hay elementos.',
    currentUserId,
}: AnnotationManagerProps) {
    const { toast } = useToast();
    const { userRole } = useAuth();
    const isSecretary = userRole === 'secretary';
    const [isDialogOpen, setDialogOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [errors, setErrors] = useState<{ description?: string[] }>({});
    const [isPending, setIsPending] = useState(false);
    const [deleteItem, setDeleteItem] = useState<AnnotationItem | null>(null);
    const [userNames, setUserNames] = useState<Record<string, string>>({});

    const handleDialogOpenChange = (open: boolean) => {
        setDialogOpen(open);
        if (!open) {
            setInputValue('');
            setErrors({});
        }
    };

    useEffect(() => {
        let isMounted = true;

        const fetchUserNames = async () => {
            const uniqueUserIds = Array.from(
                new Set(
                    items
                        .map((item) => item.userId)
                        .filter((id): id is string => Boolean(id))
                )
            );
            const missingUserIds = uniqueUserIds.filter((id) => !userNames[id]);

            if (missingUserIds.length === 0) return;

            try {
                const entries = await Promise.all(
                    missingUserIds.map(async (id) => {
                        const userDocRef = doc(usersCollection, id);
                        const userDoc = await getDoc(userDocRef);
                        if (!userDoc.exists()) {
                            return [id, 'Usuario'] as const;
                        }
                        const data = userDoc.data() as { name?: string; displayName?: string };
                        return [id, data.name ?? data.displayName ?? 'Usuario'] as const;
                    })
                );

                if (isMounted) {
                    setUserNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
                }
            } catch (error) {
                console.error('Error fetching annotation user names:', error);
            }
        };

        fetchUserNames();

        return () => {
            isMounted = false;
        };
    }, [items, userNames]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setErrors({});

        if (!inputValue.trim() || inputValue.trim().length < 5) {
            setErrors({ description: ['La descripcion es requerida (minimo 5 caracteres).'] });
            return;
        }

        setIsPending(true);
        try {
            await onAdd(inputValue.trim());
            toast({ title: 'Exito', description: `${buttonText} agregado.` });
            setDialogOpen(false);
            setInputValue('');
        } catch (error: unknown) {
            console.error('Error adding item:', error);
            toast({
                title: 'Error',
                description: `No se pudo agregar el ${buttonText.toLowerCase()}.`,
                variant: 'destructive',
            });
        } finally {
            setIsPending(false);
        }
    };

    const handleToggle = async (id: string, status: boolean) => {
        if (!onToggle) return;

        setIsPending(true);
        try {
            await onToggle(id, status);
        } catch (error) {
            console.error('Error toggling item:', error);
            toast({
                title: 'Error',
                description: 'No se pudo actualizar el elemento.',
                variant: 'destructive',
            });
        } finally {
            setIsPending(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;

        setIsPending(true);
        try {
            await onDelete(deleteItem.id);
            toast({ title: 'Exito', description: 'Elemento eliminado.' });
            setDeleteItem(null);
        } catch (error) {
            console.error('Error deleting item:', error);
            toast({
                title: 'Error',
                description: 'No se pudo eliminar el elemento.',
                variant: 'destructive',
            });
        } finally {
            setIsPending(false);
        }
    };

    return (
        <>
            <section>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-xl font-semibold">{title}</h2>
                        <p className="text-sm text-muted-foreground">{description}</p>
                    </div>
                    <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                {buttonText}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form onSubmit={handleSubmit}>
                                <DialogHeader>
                                    <DialogTitle>{dialogTitle}</DialogTitle>
                                </DialogHeader>
                                <div className="py-4">
                                    <Label htmlFor="description">Descripcion</Label>
                                    <Input
                                        id="description"
                                        name="description"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        placeholder={placeholder}
                                        className="mt-1"
                                    />
                                    {errors.description && (
                                        <p className="text-sm text-destructive mt-1">
                                            {errors.description[0]}
                                        </p>
                                    )}
                                </div>
                                <DialogFooter>
                                    <Button type="submit" disabled={isPending}>
                                        {isPending ? 'Guardando...' : 'Guardar'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>

                {loading ? (
                    <div className="space-y-2">
                        <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                        <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                        <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </div>
                ) : items.length === 0 ? (
                    <p className="text-sm text-center py-4 text-muted-foreground">
                        {emptyMessage}
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {items.map((item) => (
                            <li
                                key={item.id}
                                className="flex items-center justify-between gap-3 p-3 border rounded-md"
                            >
                                <div className="flex items-center gap-3 flex-1">
                                    {showCheckbox && onToggle && (
                                        <Checkbox
                                            id={item.id}
                                            checked={item.isCompleted || false}
                                            onCheckedChange={() => handleToggle(item.id, item.isCompleted || false)}
                                            disabled={isPending}
                                        />
                                    )}
                                    <div className="flex-1">
                                        <Label
                                            htmlFor={item.id}
                                            className={item.isCompleted ? 'line-through text-muted-foreground' : ''}
                                        >
                                            {item.description}
                                        </Label>
                                        {item.userId && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Por: {userNames[item.userId] ?? 'Usuario'}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {showResolveButton && onResolve && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => onResolve(item.id)}
                                            disabled={isPending}
                                            title="Marcar como resuelta"
                                        >
                                            <CheckCircle className="mr-2 h-4 w-4" />
                                            Resuelta
                                        </Button>
                                    )}
                                    {(isSecretary || (currentUserId && item.userId === currentUserId)) && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setDeleteItem(item)}
                                            disabled={isPending}
                                        >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <AlertDialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Estas seguro?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta accion eliminara permanentemente: &quot;{deleteItem?.description}&quot;.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive hover:bg-destructive/90"
                            disabled={isPending}
                        >
                            {isPending ? 'Eliminando...' : 'Eliminar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
