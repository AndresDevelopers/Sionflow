import { useState, useCallback } from 'react';
import { format } from 'date-fns';

/**
 * Custom hook para manejar campos de fecha con formato DD/MM/YYYY
 */
export function useDateField(initialValue?: Date) {
  const [input, setInput] = useState(() => formatDateForDisplay(initialValue));
  const [date, setDate] = useState<Date | undefined>(initialValue);

  const handleChange = useCallback((value: string) => {
    setInput(value);
    
    // Solo actualizar la fecha si es válida o está vacía
    const parsedDate = parseDate(value);
    if (parsedDate || !value.trim()) {
      setDate(parsedDate);
    }
  }, []);

  const handleBlur = useCallback(() => {
    const parsedDate = parseDate(input);
    
    if (parsedDate) {
      // Fecha válida: formatear correctamente
      const formattedDate = formatDateForDisplay(parsedDate);
      setInput(formattedDate);
      setDate(parsedDate);
    } else if (!input.trim()) {
      // Input vacío: limpiar todo
      setInput('');
      setDate(undefined);
    } else {
      // Fecha inválida: mantener input pero limpiar fecha
      setDate(undefined);
    }
  }, [input]);

  const reset = useCallback((newValue?: Date) => {
    setInput(formatDateForDisplay(newValue));
    setDate(newValue);
  }, []);

  return {
    input,
    date,
    handleChange,
    handleBlur,
    reset,
    isValid: date !== undefined || !input.trim()
  };
}

/**
 * Parsea una fecha desde string DD/MM/YYYY
 */
function parseDate(dateString: string): Date | undefined {
  if (!dateString.trim()) return undefined;

  const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const match = dateString.match(dateRegex);

  if (!match) return undefined;

  const [, dayStr, monthStr, yearStr] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1; // JS months are 0-indexed
  const year = parseInt(yearStr, 10);
  const currentYear = new Date().getFullYear();

  // Validar rangos
  if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900 || year > currentYear) {
    return undefined;
  }

  const date = new Date(year, month, day);
  
  // Verificar si la fecha es válida (maneja fechas inválidas como 30 de febrero)
  if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
    return undefined;
  }

  return date;
}

/**
 * Formatea una fecha para mostrar en formato DD/MM/YYYY
 */
function formatDateForDisplay(date: Date | undefined): string {
  if (!date || isNaN(date.getTime())) {
    return '';
  }
  try {
    return format(date, 'dd/MM/yyyy');
  } catch (error) {
    return '';
  }
}
