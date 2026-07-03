export interface TextSection {
  id: string;
  label: string;
  description: string;
  category: string;
}

export const textSections: TextSection[] = [
  {
    id: 'personal-info',
    label: 'Información Personal',
    description: 'Nombre, fecha de nacimiento, foto de perfil',
    category: 'Perfil'
  },
  {
    id: 'contact-info',
    label: 'Información de Contacto',
    description: 'Email, teléfono, dirección',
    category: 'Perfil'
  },
  {
    id: 'attendance',
    label: 'Registro de Asistencia',
    description: 'Asistencia a reuniones y actividades',
    category: 'Actividades'
  },
  {
    id: 'assignments',
    label: 'Asignaciones',
    description: 'Responsabilidades y asignaciones asignadas',
    category: 'Actividades'
  },
  {
    id: 'reports',
    label: 'Reportes',
    description: 'Reportes de visitas y enseñanzas',
    category: 'Reportes'
  },
  {
    id: 'teaching-record',
    label: 'Registro de Enseñanzas',
    description: 'Historial de enseñanzas dadas',
    category: 'Reportes'
  },
  {
    id: 'statistics',
    label: 'Estadísticas',
    description: 'Estadísticas de progreso y rendimiento',
    category: 'Análisis'
  },
  {
    id: 'notifications',
    label: 'Notificaciones',
    description: 'Alertas y recordatorios',
    category: 'Sistema'
  }
];

export const getTextSectionsByCategory = () => {
  const categories: Record<string, TextSection[]> = {};
  
  textSections.forEach(section => {
    if (!categories[section.category]) {
      categories[section.category] = [];
    }
    categories[section.category].push(section);
  });
  
  return categories;
};
