import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, RefreshCw, UserPlus, Edit, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Timestamp } from 'firebase/firestore';

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  [key: string]: any;
}

export interface Convert {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  baptismDate?: Timestamp | Date | string;
  [key: string]: any;
}

export interface NewConvertFriendship {
  id: string;
  convertId: string;
  convertName?: string;
  friends: string[];
  friendNames?: string[];
  assignedAt: Date | Timestamp | string;
  [key: string]: any;
}

interface NewConvertsTabProps {
  friendships: NewConvertFriendship[];
  newConverts: Convert[];
  members: Member[];
  loading: boolean;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: Convert | NewConvertFriendship) => void;
}

export function NewConvertsTab({ 
  friendships, 
  newConverts, 
  members = [], 
  loading, 
  onRefresh,
  onDelete,
  onEdit
}: NewConvertsTabProps) {
  // Function to safely get member name by ID
  const getMemberName = (memberId: string): string => {
    try {
      if (!Array.isArray(members)) {
        console.warn('Members data is not an array:', members);
        return memberId;
      }

      const id = String(memberId || '').trim();
      if (!id) return 'ID no válido';

      const member = members.find(m => m && m.id === id);
      if (!member) return id;

      return [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || id;
    } catch (error) {
      console.error('Error in getMemberName:', error);
      return memberId;
    }
  };

  // Function to get friend names from friendship record
  const getFriendNames = (friendship: NewConvertFriendship): string => {
    try {
      if (friendship?.friendNames?.length) {
        return friendship.friendNames.join(', ');
      }
      
      if (friendship?.friends?.length) {
        return friendship.friends
          .filter((id): id is string => typeof id === 'string')
          .map(id => getMemberName(id))
          .filter(Boolean)
          .join(', ');
      }
      
      return 'Sin amigos asignados';
    } catch (error) {
      console.error('Error getting friend names:', error);
      return 'Error al cargar amigos';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const formatDate = (date?: Timestamp | Date | string): string => {
    if (!date) return 'No especificada';
    try {
      const dateObj = date instanceof Timestamp ? date.toDate() : new Date(date);
      return dateObj.toLocaleDateString();
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Fecha inválida';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevos Conversos</CardTitle>
        <CardDescription>Gestión de nuevos conversos y sus asignaciones</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-end mb-4">
          <Button onClick={onRefresh} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar
          </Button>
        </div>
        
        <Tabs defaultValue="nuevos" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="nuevos">Nuevos Conversos</TabsTrigger>
            <TabsTrigger value="amistades">Asignaciones de Amistad</TabsTrigger>
          </TabsList>
          
          <TabsContent value="nuevos">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Fecha de Bautismo</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newConverts.map((convert) => (
                  <TableRow key={convert.id}>
                    <TableCell>
                      {convert.name || [convert.firstName, convert.lastName].filter(Boolean).join(' ').trim() || 'Nombre no disponible'}
                    </TableCell>
                    <TableCell>
                      {formatDate(convert.baptismDate)}
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => onEdit(convert)}
                        className="gap-2"
                      >
                        <UserPlus className="h-4 w-4" />
                        Asignar Amigos
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          
          <TabsContent value="amistades">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conversos</TableHead>
                  <TableHead>Amigos Asignados</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {friendships.map((friendship) => {
                  const convert = newConverts.find(c => c.id === friendship.convertId);
                  return (
                    <TableRow key={friendship.id}>
                      <TableCell>
                        {convert?.name || friendship.convertName || 'Conversión no encontrada'}
                      </TableCell>
                      <TableCell>{getFriendNames(friendship)}</TableCell>
                      <TableCell className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(friendship)}
                        >
                          Editar
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4 mr-1" />
                              Eliminar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta acción eliminará permanentemente esta asignación de amistad. ¿Deseas continuar?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => onDelete(friendship.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
