import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, RefreshCw, UserPlus, Trash2 } from 'lucide-react';
import { useI18n } from '@/contexts/i18n-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Timestamp } from 'firebase/firestore';
import { MemberPhoto } from '@/components/members/member-photo';

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
  canWrite: boolean;
}

export function NewConvertsTab({ 
  friendships, 
  newConverts, 
  members = [], 
  loading, 
  onRefresh,
  onDelete,
  onEdit,
  canWrite
}: NewConvertsTabProps) {
  const { t } = useI18n();

  // Function to safely get member name by ID
  const getMemberName = (memberId: string): string => {
    try {
      if (!Array.isArray(members)) {
        console.warn('Members data is not an array:', members);
        return memberId;
      }

      const id = String(memberId || '').trim();
      if (!id) return t('newConverts.invalidId');

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
      
      return t('newConverts.noFriendsAssigned');
    } catch (error) {
      console.error('Error getting friend names:', error);
      return t('newConverts.loadFriendsError');
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
    if (!date) return t('newConverts.unspecified');
    try {
      const dateObj = date instanceof Timestamp ? date.toDate() : new Date(date);
      return dateObj.toLocaleDateString();
    } catch (error) {
      console.error('Error formatting date:', error);
      return t('newConverts.invalidDate');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('missionaryWork.tabs.new_converts')}</CardTitle>
        <CardDescription>{t('missionaryWork.newConverts.manageDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-end mb-4">
          <Button onClick={onRefresh} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('missionaryWork.newConverts.refresh')}
          </Button>
        </div>
        
        <Tabs defaultValue="nuevos" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="nuevos">{t('missionaryWork.tabs.new_converts')}</TabsTrigger>
            <TabsTrigger value="amistades">{t('missionaryWork.newConverts.friendshipsTab')}</TabsTrigger>
          </TabsList>
          
          <TabsContent value="nuevos">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('converts.name')}</TableHead>
                  <TableHead>{t('converts.baptismDate')}</TableHead>
                  <TableHead>{t('converts.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newConverts.map((convert) => {
                  const displayName =
                    convert.name ||
                    [convert.firstName, convert.lastName].filter(Boolean).join(' ').trim() ||
                    t('newConverts.nameUnavailable');
                  const photoURL =
                    typeof convert.photoURL === 'string' && convert.photoURL.trim()
                      ? convert.photoURL.trim()
                      : undefined;
                  return (
                  <TableRow key={convert.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <MemberPhoto photoURL={photoURL} name={displayName} size={32} />
                        <span>{displayName}</span>
                      </div>
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
                         {t('missionaryWork.newConverts.assignFriendButton')}
                       </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TabsContent>
          
          <TabsContent value="amistades">
            <Table>
              <TableHeader>
                <TableRow>
                <TableHead>{t('missionaryWork.newConverts.convertsHeader')}</TableHead>
                <TableHead>{t('missionaryWork.newConverts.assignedFriends')}</TableHead>
                <TableHead>{t('converts.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {friendships.map((friendship) => {
                  const convert = newConverts.find(c => c.id === friendship.convertId);
                  return (
                    <TableRow key={friendship.id}>
                      <TableCell>
                        {convert?.name || friendship.convertName || t('newConverts.conversionNotFound')}
                      </TableCell>
                      <TableCell>{getFriendNames(friendship)}</TableCell>
                      <TableCell className="flex gap-2">
                        {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(friendship)}
                        >
                          {t('missionaryWork.newConverts.editButton')}
                        </Button>
                        )}
                        {canWrite && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4 mr-1" />
                              {t('missionaryWork.newConverts.deleteButton')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('missionaryWork.newConverts.deleteDialogTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('missionaryWork.newConverts.deleteConfirmDescription')}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('missionaryWork.newConverts.cancelButton')}</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => onDelete(friendship.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                {t('missionaryWork.newConverts.deleteButton')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        )}
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
