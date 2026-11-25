import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ensureSchema } from '../db/schema.js';
import { query } from '../db/pool.js';

/**
 * 数据隔离集成测试（需要本地 Postgres 运行中，DATABASE_URL 见 .env）
 * 验证多用户场景下书签/会话数据按 user_id 隔离，他人不可见、不可改、不可删。
 */

let userA = '';
let userB = '';

before(async () => {
    await ensureSchema();
    const suffix = randomUUID().slice(0, 8);
    const hash = await bcrypt.hash('passw0rd123', 10);
    const a = await query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [`test_iso_a_${suffix}`, hash],
    );
    const b = await query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [`test_iso_b_${suffix}`, hash],
    );
    userA = a.rows[0].id;
    userB = b.rows[0].id;
});

after(async () => {
    await query('DELETE FROM users WHERE id = ANY($1)', [[userA, userB]]);
});

describe('用户名唯一约束', () => {
    it('重复用户名插入被拒绝', async () => {
        const dup = await query(
            'SELECT id FROM users WHERE username = (SELECT username FROM users WHERE id = $1)',
            [userA],
        );
        assert.equal(dup.rowCount, 1);
        await assert.rejects(
            query(
                'INSERT INTO users (username, password_hash) VALUES ((SELECT username FROM users WHERE id = $1), $2)',
                [userA, 'x12345678'],
            ),
        );
    });
});

describe('书签数据隔离', () => {
    it('B 看不到 A 的书签，也不能改/删', async () => {
        const bm = await query(
            `INSERT INTO bookmarks (user_id, title, url) VALUES ($1, $2, $3) RETURNING id`,
            [userA, '机密书签', 'https://example.com/secret'],
        );
        const id = bm.rows[0].id;

        // 与路由相同的隔离查询条件
        const visibleToB = await query('SELECT * FROM bookmarks WHERE id = $1 AND user_id = $2', [id, userB]);
        assert.equal(visibleToB.rowCount, 0);

        const noUpdate = await query(
            'UPDATE bookmarks SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
            ['篡改', id, userB],
        );
        assert.equal(noUpdate.rowCount, 0);

        const noDelete = await query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING id', [
            id,
            userB,
        ]);
        assert.equal(noDelete.rowCount, 0);

        const stillThere = await query('SELECT title FROM bookmarks WHERE id = $1', [id]);
        assert.equal(stillThere.rows[0].title, '机密书签');

        await query('DELETE FROM bookmarks WHERE id = $1', [id]);
    });
});

describe('会话数据隔离', () => {
    it('B 无法读取 A 的会话消息，删除也不生效', async () => {
        const s = await query(
            `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id`,
            [userA, 'A 的私密会话'],
        );
        const id = s.rows[0].id;
        await query('INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)', [
            id,
            'user',
            '私密内容',
        ]);

        const ownedByB = await query('SELECT 1 FROM chat_sessions WHERE id = $1 AND user_id = $2', [id, userB]);
        assert.equal(ownedByB.rowCount, 0);

        const noDelete = await query('DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id', [
            id,
            userB,
        ]);
        assert.equal(noDelete.rowCount, 0);

        const msgsForA = await query('SELECT content FROM chat_messages WHERE session_id = $1', [id]);
        assert.equal(msgsForA.rowCount, 1);

        // 删除会话时消息级联清理
        await query('DELETE FROM chat_sessions WHERE id = $1', [id]);
        const afterCascade = await query('SELECT 1 FROM chat_messages WHERE session_id = $1', [id]);
        assert.equal(afterCascade.rowCount, 0);
    });
});
