import * as babel from '@babel/core'
import babelReact from '@babel/preset-react'
import * as babelParser from '@babel/parser'


export const parseReactOpts = { plugins: [ 'jsx' ] }
export const transformReactOpts = { presets: [ babelReact ] }


export const parseJSExpr = sourcecode =>
    babelParser.parseExpression(sourcecode, parseReactOpts)


export const transformJSAst = (programAst, code) =>
    babel.transformFromAstSync(programAst, code, transformReactOpts).code


export const programReturnExprAst = exprAst => ({
    type: 'Program',
    interpreter: null,
    sourceType: 'module',
    body: [
        {
            type: "ReturnStatement",
            argument: exprAst,
        },
    ],
    directives: [],
})


export const transformJSExpr = sourcecode =>
    transformJSAst(
        programReturnExprAst(
            parseJSExpr(sourcecode)
        ),
        sourcecode,
    )


export const computeExpr = (code, env) => {
    if (!code) { return }
    try {
        const exprFunc = new Function(
            ...Object.keys(env),
            transformJSExpr(code),
        )
        return exprFunc(...Object.values(env))
    }
    catch (e) {
        return e
    }
}
