import '@/test-support/page-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor, within } from '@/test-support/render';
import { getMembersByStatus } from '@/lib/members-data';
import { offlineDataKey } from '@/lib/offline-data-store';
import type { Member } from '@/lib/types';
import ObservationsPage from '@/app/(main)/observations/page';

const CARD_TITLE = /without endowment|sin investidura/i;
const NEXT_BUTTON = /^(next|siguiente)$/i;
const FIRST_PAGE_RANGE = /1[–-]15/;

function makeMember(index: number): Member {
  return {
    id: `member-${index}`,
    firstName: `Miembro${index}`,
    lastName: 'Prueba',
    status: 'active',
    ordinances: [],
    createdAt: { seconds: 0, nanoseconds: 0 },
    updatedAt: { seconds: 0, nanoseconds: 0 },
    createdBy: 'test-user-1',
  } as unknown as Member;
}

function makeTempleRecommendMember(index: number, firstName: string, daysFromNow: number): Member {
  return {
    ...makeMember(index),
    firstName,
    hasTempleRecommend: true,
    templeRecommendExpirationDate: new Date(Date.now() + daysFromNow * 86_400_000),
  } as unknown as Member;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getMembersByStatus).mockResolvedValue(
    Array.from({ length: 20 }, (_, index) => makeMember(index))
  );
});

describe('observations page lists', () => {
  it('opens a 15-row dialog from a card instead of rendering the full list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObservationsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('20').length).toBeGreaterThan(0);
    });

    // Lists are not rendered until their card is clicked
    expect(screen.queryByText('Miembro0 Prueba')).not.toBeInTheDocument();

    await user.click(screen.getAllByText(CARD_TITLE)[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Miembro0 Prueba')).toBeInTheDocument();
    expect(within(dialog).getByText('Miembro14 Prueba')).toBeInTheDocument();
    expect(within(dialog).queryByText('Miembro15 Prueba')).not.toBeInTheDocument();
    expect(within(dialog).getByText(FIRST_PAGE_RANGE)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: NEXT_BUTTON }));

    expect(await within(dialog).findByText('Miembro19 Prueba')).toBeInTheDocument();
    expect(within(dialog).queryByText('Miembro0 Prueba')).not.toBeInTheDocument();
  });

  it('searches members inside the open list dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObservationsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('20').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText(CARD_TITLE)[0]);

    const dialog = await screen.findByRole('dialog');
    const search = within(dialog).getByPlaceholderText(/buscar miembro|search member/i);
    await user.type(search, 'Miembro19');

    expect(await within(dialog).findByText('Miembro19 Prueba')).toBeInTheDocument();
    expect(within(dialog).queryByText('Miembro0 Prueba')).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/mostrando 1[–-]1 de 1|showing 1[–-]1 of 1/i)
    ).toBeInTheDocument();
  });

  it('filters temple recommends between expiring and expired', async () => {
    vi.mocked(getMembersByStatus).mockResolvedValue([
      makeTempleRecommendMember(1, 'Vencida', -5),
      makeTempleRecommendMember(2, 'PorVencer', 10),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ObservationsPage />);

    const cardTitle = await screen.findByText(/por vencer y vencidas|expiring or expired/i);
    await user.click(cardTitle);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Vencida Prueba')).toBeInTheDocument();
    expect(within(dialog).getByText('PorVencer Prueba')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^vencidas$|^expired$/i }));
    expect(within(dialog).queryByText('PorVencer Prueba')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Vencida Prueba')).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: /^por vencer$|^expiring soon$/i })
    );
    expect(within(dialog).queryByText('Vencida Prueba')).not.toBeInTheDocument();
    expect(within(dialog).getByText('PorVencer Prueba')).toBeInTheDocument();
  });

  it('shows the locally cached snapshot when the network fetch fails', async () => {
    localStorage.setItem(
      offlineDataKey('observations', 'test-barrio|test-org'),
      JSON.stringify({
        members: [makeMember(1), makeMember(2)],
        companionships: [],
        healthConcerns: [],
        savedAt: Date.now(),
      })
    );
    vi.mocked(getMembersByStatus).mockRejectedValue(new Error('offline'));

    renderWithProviders(<ObservationsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    });

    // Cached data feeds the cards; lists stay closed until requested
    expect(screen.queryByText('Miembro1 Prueba')).not.toBeInTheDocument();
  });
});
