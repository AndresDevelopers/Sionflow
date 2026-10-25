import { Timestamp } from 'firebase/firestore';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ConvertInfoSheet, type ConvertWithInfo } from '@/app/(main)/converts/convert-info-sheet';
import { renderWithProviders, screen, waitFor } from '@/test-support/render';

function buildConvert(overrides: Partial<ConvertWithInfo> = {}): ConvertWithInfo {
  return {
    id: 'convert_1',
    name: 'Juan Perez',
    baptismDate: Timestamp.now(),
    friendship: {
      id: 'friend_1',
      convertId: 'convert_1',
      convertName: 'Juan Perez',
      friends: ['member_1'],
      assignedAt: Timestamp.now(),
    },
    recommendationActive: true,
    selfRelianceCourse: false,
    hasLdsAccount: true,
    hasFamilySearchAccount: false,
    memberData: {
      id: 'member_1',
      firstName: 'Juan',
      lastName: 'Perez',
      status: 'active',
      hasLdsAccount: true,
      hasFamilySearchAccount: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: 'test',
    },
    ...overrides,
  };
}

const availableMembers = [
  {
    id: 'member_1',
    firstName: 'Carlos',
    lastName: 'Lopez',
    status: 'active' as const,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: 'test',
  },
];

describe('ConvertInfoSheet', () => {
  it('renders convert name, recommendation and digital account toggles when open', () => {
    renderWithProviders(
      <ConvertInfoSheet
        convert={buildConvert()}
        isOpen={true}
        onOpenChange={() => {}}
        onSave={async () => {}}
        canWrite={true}
        saving={false}
        availableMembers={availableMembers}
      />,
    );

    expect(screen.getByText('Juan Perez')).toBeInTheDocument();
    expect(screen.getAllByText(/Cuenta LDS|LDS Account/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FamilySearch/i).length).toBeGreaterThan(0);
    // Al activar recomendación se pueden registrar (opcionalmente) sus fechas
    expect(
      screen.getByText(/Inicio de la recomendación|Recommend date started/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Vencimiento de la recomendación|Recommend expiration date/i)
    ).toBeInTheDocument();
  });

  it('shows the recommend dates when the switch is enabled and saves without dates', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});

    renderWithProviders(
      <ConvertInfoSheet
        convert={buildConvert({ recommendationActive: false })}
        isOpen={true}
        onOpenChange={() => {}}
        onSave={onSave}
        canWrite={true}
        saving={false}
        availableMembers={availableMembers}
      />,
    );

    expect(
      screen.queryByText(/Inicio de la recomendación|Recommend date started/i)
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', { name: /recomendación|temple recommend/i })
    );

    expect(
      await screen.findByText(/Inicio de la recomendación|Recommend date started/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Vencimiento de la recomendación|Recommend expiration date/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /guardar cambios|save changes/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave).toHaveBeenCalledWith(
      'convert_1',
      expect.objectContaining({
        recommendationActive: true,
        recommendationIssueDate: null,
        recommendationExpirationDate: null,
      }),
    );
  });
});
