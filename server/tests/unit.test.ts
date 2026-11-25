import 'dotenv/config';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeLike } from '../utils/like.js';
import { requireAuth, signToken, type AuthedRequest } from '../auth/middleware.js';

/** 构造最小可用的 Express req/res 桩对象 */
const makeRes = () => {
    const res = {
        statusCode: 0,
        body: undefined as unknown,
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        json(payload: unknown) {
            res.body = payload;
            return res;
        },
    };
    return res;
};

const runAuth = (header: string) => {
    const req = { header: (name: string) => (name === 'authorization' ? header : undefined) };
    const res = makeRes();
    let nextCalled = false;
    requireAuth(req as never, res as never, () => {
        nextCalled = true;
    });
    return { res, nextCalled, req: req as AuthedRequest };
};

describe('escapeLike', () => {
    it('转义 % _ 反斜杠', () => {
        assert.equal(escapeLike('100%'), '100\\%');
        assert.equal(escapeLike('a_b'), 'a\\_b');
        assert.equal(escapeLike('a\\b'), 'a\\\\b');
    });
    it('普通文本不变', () => {
        assert.equal(escapeLike('vue3 教程'), 'vue3 教程');
    });
});

describe('JWT 鉴权', () => {
    it('签发的 token 能通过 requireAuth 并挂载 userId', () => {
        const token = signToken('u-123', 'alice');
        const { res, nextCalled, req } = runAuth(`Bearer ${token}`);
        assert.equal(res.statusCode, 0);
        assert.equal(nextCalled, true);
        assert.equal(req.userId, 'u-123');
        assert.equal(req.username, 'alice');
    });
    it('伪造 token 返回 401', () => {
        const { res, nextCalled } = runAuth('Bearer fake.token.here');
        assert.equal(res.statusCode, 401);
        assert.equal(nextCalled, false);
    });
    it('缺少 Authorization 头返回 401', () => {
        const { res, nextCalled } = runAuth('');
        assert.equal(res.statusCode, 401);
        assert.equal(nextCalled, false);
    });
});
