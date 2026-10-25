import '@/test-support/page-mocks';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '@/test-support/render';
import { MemberForm } from '@/components/members/member-form';
import { createMember } from '@/lib/members-data';

const LABEL = {
  switch: /recomendación para el templo|has temple recommend/i,
  issue: /inicio de la recomendación|recommend date started/i,
  expiration: /vencimiento de la recomendación|recommend expiration date/i,
};

describe('MemberForm temple recommend', () => {
  it('shows the recommend dates only after enabling the switch', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MemberForm member={null} onClose={vi.fn()} />);

    expect(await screen.findByLabelText(/llamamiento|calling/i)).toBeInTheDocument();

    const recommendSwitch = await screen.findByRole('switch', { name: LABEL.switch });

    expect(screen.queryByText(LABEL.issue)).not.toBeInTheDocument();
    expect(screen.queryByText(LABEL.expiration)).not.toBeInTheDocument();

    await user.click(recommendSwitch);

    expect(await screen.findByText(LABEL.issue)).toBeInTheDocument();
    expect(screen.getByText(LABEL.expiration)).toBeInTheDocument();
  });

  it('saves with the recommend switch on and no dates', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<MemberForm member={null} onClose={onClose} />);

    await user.type(await screen.findByLabelText(/nombre \*|first name \*/i), 'Juan');
    await user.type(screen.getByLabelText(/apellido \*|last name \*/i), 'Perez');

    await user.click(screen.getByRole('switch', { name: LABEL.switch }));
    expect(await screen.findByText(LABEL.issue)).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /crear miembro|create member/i })
    );

    // Las fechas son opcionales: la recomendación se guarda sin ellas
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 5000 });

    expect(createMember).toHaveBeenCalledTimes(1);
    const savedMember = vi.mocked(createMember).mock.calls[0][0];
    expect(savedMember.hasTempleRecommend).toBe(true);
    expect(savedMember.templeRecommendIssueDate).toBeFalsy();
    expect(savedMember.templeRecommendExpirationDate).toBeFalsy();
  }, 20000);
});
