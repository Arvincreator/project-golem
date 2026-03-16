const acorn = require('acorn');

const ALLOWED_NODE_TYPES = new Set([
  'FunctionDeclaration', 'VariableDeclaration', 'ExpressionStatement',
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'ReturnStatement',
  'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression',
  'TemplateLiteral', 'AssignmentExpression', 'BlockStatement', 'Program',
  'BinaryExpression', 'UnaryExpression', 'UpdateExpression',
  'LogicalExpression', 'ConditionalExpression', 'MemberExpression',
  'Property', 'SpreadElement', 'SwitchStatement', 'SwitchCase',
  'BreakStatement', 'ContinueStatement', 'TryStatement', 'CatchClause',
  'ThrowStatement', 'Literal', 'Identifier', 'CallExpression',
  'NewExpression', 'SequenceExpression', 'TaggedTemplateExpression',
  'TemplateElement', 'ClassDeclaration', 'ClassBody', 'MethodDefinition',
  'ThisExpression', 'Super', 'AwaitExpression', 'YieldExpression',
  'LabeledStatement', 'EmptyStatement', 'DebuggerStatement',
  'FunctionExpression', 'AssignmentPattern', 'RestElement',
  'ArrayPattern', 'ObjectPattern', 'ExportNamedDeclaration',
  'ExportDefaultDeclaration', 'ImportDeclaration', 'ImportSpecifier',
  'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'MetaProperty',
  'ChainExpression', 'PropertyDefinition', 'PrivateIdentifier',
  'StaticBlock', 'VariableDeclarator', 'ImportExpression',
  'ParenthesizedExpression'
]);

const DANGEROUS_GLOBALS = new Set([
  'process', 'global', 'globalThis'
]);

class CodeSafetyValidator {
  /**
   * Parse code and validate its AST for safety.
   * @param {string} code - JavaScript source code to validate
   * @returns {{ safe: boolean, reason?: string }}
   */
  static validate(code) {
    let ast;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true
      });
    } catch (err) {
      return { safe: false, reason: `Syntax error: ${err.message}` };
    }

    const result = { safe: true };

    function reject(reason) {
      result.safe = false;
      result.reason = reason;
    }

    function walk(node) {
      if (!node || typeof node !== 'object' || !result.safe) return;

      if (node.type) {
        // Check allowlist
        if (!ALLOWED_NODE_TYPES.has(node.type)) {
          reject(`Disallowed node type: ${node.type}`);
          return;
        }

        // Reject dangerous CallExpressions
        if (node.type === 'CallExpression') {
          const callee = node.callee;

          // require(...)
          if (callee.type === 'Identifier' && callee.name === 'require') {
            reject('Forbidden call: require() is not allowed');
            return;
          }

          // eval(...)
          if (callee.type === 'Identifier' && callee.name === 'eval') {
            reject('Forbidden call: eval() is not allowed');
            return;
          }

          // Function(...)
          if (callee.type === 'Identifier' && callee.name === 'Function') {
            reject('Forbidden call: Function() is not allowed');
            return;
          }

          // import(...)
          if (callee.type === 'Identifier' && callee.name === 'import') {
            reject('Forbidden call: import() is not allowed');
            return;
          }
          if (callee.type === 'MetaProperty' || node.type === 'ImportExpression') {
            reject('Forbidden call: dynamic import() is not allowed');
            return;
          }

          // setTimeout / setInterval with string argument
          if (
            callee.type === 'Identifier' &&
            (callee.name === 'setTimeout' || callee.name === 'setInterval')
          ) {
            const firstArg = node.arguments && node.arguments[0];
            if (
              firstArg &&
              (firstArg.type === 'Literal' && typeof firstArg.value === 'string' ||
               firstArg.type === 'TemplateLiteral')
            ) {
              reject(`Forbidden call: ${callee.name}() with string argument is not allowed`);
              return;
            }
          }
        }

        // Reject dangerous NewExpressions
        if (node.type === 'NewExpression') {
          const callee = node.callee;
          if (callee.type === 'Identifier' && callee.name === 'Function') {
            reject('Forbidden: new Function() is not allowed');
            return;
          }
        }

        // Reject dangerous MemberExpressions
        if (node.type === 'MemberExpression') {
          const obj = node.object;

          // process.*, global.*, globalThis.*
          if (obj.type === 'Identifier' && DANGEROUS_GLOBALS.has(obj.name)) {
            reject(`Forbidden access: ${obj.name} is not allowed`);
            return;
          }

          // __proto__ access
          const propName = node.computed
            ? (node.property.type === 'Literal' ? node.property.value : null)
            : (node.property.type === 'Identifier' ? node.property.name : null);

          if (propName === '__proto__') {
            reject('Forbidden access: __proto__ is not allowed');
            return;
          }

          // constructor.prototype
          if (
            propName === 'prototype' &&
            obj.type === 'MemberExpression'
          ) {
            const innerProp = obj.computed
              ? (obj.property.type === 'Literal' ? obj.property.value : null)
              : (obj.property.type === 'Identifier' ? obj.property.name : null);

            if (innerProp === 'constructor') {
              reject('Forbidden access: constructor.prototype is not allowed');
              return;
            }
          }
        }
      }

      // Recurse into child nodes
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
          continue;
        }
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type) {
              walk(item);
              if (!result.safe) return;
            }
          }
        } else if (child && typeof child === 'object' && child.type) {
          walk(child);
          if (!result.safe) return;
        }
      }
    }

    walk(ast);
    return result;
  }

  /**
   * Check code syntax using acorn.parse (no new Function).
   * @param {string} code - JavaScript source code to check
   * @returns {{ valid: boolean, error?: string }}
   */
  static syntaxCheck(code) {
    try {
      acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true
      });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }
}

module.exports = CodeSafetyValidator;
