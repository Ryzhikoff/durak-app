import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { AdminTextReactionDTO } from '@durak/shared-types';

const fetchAdminMock = vi.fn(async (): Promise<AdminTextReactionDTO[]> => []);
const createMock = vi.fn(
  async (body: { text: string; sortOrder?: number; enabled?: boolean }): Promise<AdminTextReactionDTO> => ({
    id: 'new-id',
    text: body.text,
    sortOrder: body.sortOrder ?? 0,
    enabled: body.enabled ?? true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
);
const updateMock = vi.fn(
  async (id: string, body: { text?: string; sortOrder?: number; enabled?: boolean }): Promise<AdminTextReactionDTO> => ({
    id,
    text: body.text ?? 'old',
    sortOrder: body.sortOrder ?? 0,
    enabled: body.enabled ?? true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
);
const deleteMock = vi.fn(async (id: string): Promise<{ id: string }> => ({ id }));

vi.mock('./textReactionsApi', () => ({
  fetchAdminTextReactions: () => fetchAdminMock(),
  createTextReaction: (body: { text: string; sortOrder?: number; enabled?: boolean }) =>
    createMock(body),
  updateTextReaction: (id: string, body: { text?: string; sortOrder?: number; enabled?: boolean }) =>
    updateMock(id, body),
  deleteTextReaction: (id: string) => deleteMock(id),
}));

import { AdminTextReactionsPage } from './AdminTextReactionsPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminTextReactionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminTextReactionsPage', () => {
  beforeEach(() => {
    fetchAdminMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    fetchAdminMock.mockImplementation(async () => []);
  });

  it('renders empty state when the list is empty', async () => {
    fetchAdminMock.mockImplementationOnce(async () => []);
    renderPage();
    await screen.findByRole('heading', { name: /Текстовые реакции/i });
    await screen.findByText(/Реакций пока нет/i);
  });

  it('renders existing rows with their text', async () => {
    fetchAdminMock.mockImplementationOnce(async () => [
      {
        id: 'r1',
        text: 'Хороший ход!',
        sortOrder: 0,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'r2',
        text: 'Ох-ох',
        sortOrder: 1,
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    renderPage();
    await screen.findByText('Хороший ход!');
    await screen.findByText('Ох-ох');
    // Both the active and disabled badges are rendered for their respective
    // rows. "Активна" also appears as a column header, so we just check the
    // disabled state which is unique.
    expect(screen.getByText(/Отключена/)).toBeTruthy();
  });

  it('opens the add modal and creates a new reaction', async () => {
    fetchAdminMock.mockImplementation(async () => []);
    createMock.mockImplementationOnce(async () => ({
      id: 'r-new',
      text: 'Привет!',
      sortOrder: 0,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    renderPage();
    await screen.findByRole('heading', { name: /Текстовые реакции/i });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Добавить/i }));

    const input = await screen.findByTestId('text-reaction-text-input');
    await user.type(input, 'Привет!');
    // The save button is the only submit button inside the modal form. We look
    // up by role + name to be modal-scoped (we have a delete confirm modal in
    // the tree too — but it's not open here).
    const saveButtons = screen.getAllByRole('button', { name: /Сохранить/i });
    await user.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].text).toBe('Привет!');
  });

  it('opens the edit modal with prefilled text and patches on save', async () => {
    fetchAdminMock.mockImplementation(async () => [
      {
        id: 'r1',
        text: 'старое',
        sortOrder: 5,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    updateMock.mockImplementationOnce(async (id, body) => ({
      id,
      text: body.text ?? 'старое',
      sortOrder: body.sortOrder ?? 5,
      enabled: body.enabled ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    renderPage();
    await screen.findByText('старое');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Редактировать/i }));

    const input = await screen.findByTestId('text-reaction-text-input');
    await user.clear(input);
    await user.type(input, 'новое');
    const saveButtons = screen.getAllByRole('button', { name: /Сохранить/i });
    await user.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0]).toBe('r1');
    expect(updateMock.mock.calls[0][1].text).toBe('новое');
  });
});
