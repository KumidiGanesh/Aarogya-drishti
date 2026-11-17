const errorMessage = require('../src/utils/errorMessage');

describe('errorMessage', () => {
  it('includes nested connection details for aggregate errors', () => {
    const connectionError = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    const aggregateError = new AggregateError([connectionError]);
    expect(errorMessage(aggregateError)).toBe('ECONNREFUSED: connection refused');
  });
});
