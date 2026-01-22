import { getORM } from '@/src/lib/db';
import { Todo } from '@/src/entities/Todo';
import { revalidatePath } from 'next/cache';
import { getSchemaName } from '@/src/lib/schema-utils';

export const dynamic = 'force-dynamic';

async function addTodo(formData: FormData) {
  'use server';
  const title = formData.get('title') as string;
  if (!title?.trim()) return;

  const orm = await getORM();
  const em = orm.em.fork();

  const todo = new Todo();
  todo.title = title.trim();

  await em.persistAndFlush(todo);
  revalidatePath('/');
}

async function toggleTodo(id: number) {
  'use server';
  const orm = await getORM();
  const em = orm.em.fork();
  const todo = await em.findOne(Todo, { id });
  if (todo) {
    todo.completed = !todo.completed;
    await em.flush();
  }
  revalidatePath('/');
}

async function deleteTodo(id: number) {
  'use server';
  const orm = await getORM();
  const em = orm.em.fork();
  await em.nativeDelete(Todo, { id });
  revalidatePath('/');
}

export default async function Home() {
  const orm = await getORM();
  const todos = await orm.em.fork().find(Todo, {}, { orderBy: { createdAt: 'DESC' } });
  const schemaName = getSchemaName();

  return (
    <main className="container">
      <header>
        <h1>Schema-per-Branch TODO Demo</h1>
        <p>
          Current schema: <code>{schemaName}</code>
        </p>
      </header>

      <section>
        <h2>Add Todo</h2>
        <form action={addTodo}>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <input
              type="text"
              name="title"
              placeholder="What needs to be done?"
              required
              autoFocus
            />
            <button type="submit">Add</button>
          </div>
        </form>
      </section>

      <section>
        <h2>Todos ({todos.length})</h2>
        {todos.length === 0 ? (
          <p>No todos yet. Add one above!</p>
        ) : (
          <ul>
            {todos.map((todo) => (
              <li key={todo.id} style={{ listStyle: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <form action={toggleTodo.bind(null, todo.id)}>
                    <button
                      type="submit"
                      style={{
                        background: todo.completed ? '#1095c1' : 'transparent',
                        border: '2px solid #1095c1',
                        borderRadius: '4px',
                        width: '1.5rem',
                        height: '1.5rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        margin: 0,
                        color: todo.completed ? 'white' : '#1095c1',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {todo.completed ? '✓' : ''}
                    </button>
                  </form>
                  <span
                    style={{
                      flex: 1,
                      textDecoration: todo.completed ? 'line-through' : 'none',
                      color: todo.completed ? 'var(--muted-color)' : 'inherit',
                    }}
                  >
                    {todo.title}
                  </span>
                  <form action={deleteTodo.bind(null, todo.id)}>
                    <button
                      type="submit"
                      className="secondary"
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer style={{ marginTop: '3rem', fontSize: '0.875rem', color: 'var(--muted-color)' }}>
        <p>
          This demo shows schema-per-branch preview deployments. Each PR gets its own isolated
          database schema.
        </p>
      </footer>
    </main>
  );
}
// TODO: Add due date tracking
