import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangelogDialog, formatEntryDate } from '@/components/changelog-dialog';
import { renderWithProviders, screen } from '@/test-support/render';

const changelog = {
  current: '1.1.47',
  entries: [
    {
      version: '1.1.47',
      date: '2026-10-25',
      changes: {
        es: {
          added: ['Ahora puedes registrar la recomendación para el templo y su fecha de vencimiento.'],
        },
        en: {
          added: ['You can now record the temple recommend and its expiry date.'],
        },
      },
    },
    {
      version: '1.1.45',
      date: '2026-09-03',
      changes: {
        es: { fixed: ['Corregimos el inicio de sesión en celulares.'] },
        en: { fixed: ['We fixed signing in on phones.'] },
      },
    },
  ],
};

describe('ChangelogDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('language', 'es');
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => changelog })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows readable dates and categorized sections', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ChangelogDialog>
        <button type="button">Abrir</button>
      </ChangelogDialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(await screen.findByText(/v1\.1\.47/)).toBeInTheDocument();
    expect(await screen.findByText('25 de octubre de 2026')).toBeInTheDocument();
    expect(screen.getByText('Agregado')).toBeInTheDocument();
    expect(screen.getByText('Corregido')).toBeInTheDocument();
    expect(screen.queryByText('Actualizaciones')).not.toBeInTheDocument();
  });

  it('formats entry dates in the active language', () => {
    expect(formatEntryDate('2026-10-25', 'es')).toBe('25 de octubre de 2026');
    expect(formatEntryDate('2026-10-25', 'en')).toBe('October 25, 2026');
    expect(formatEntryDate('fecha-invalida', 'es')).toBe('fecha-invalida');
  });
});
