import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export const formatDateForInput = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

export const formatDateForDisplay = (date: Date): string => {
  return format(date, 'd MMMM yyyy', { locale: es });
};

export const formatDateTimeForDisplay = (date: Date): string => {
  return format(date, 'd MMMM yyyy, HH:mm', { locale: es });
};
