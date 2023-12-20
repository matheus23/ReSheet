import * as React from 'react'
import { Menu } from '@headlessui/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'

import { TextInput, findScrollableAncestor } from '../../ui/utils'
import * as block from '../../block'
import { Block, BlockUpdater, BlockRef, Environment } from '../../block'
import { ErrorBoundary, ValueInspector } from '../../ui/value'
import { SheetBlockState, SheetBlockLine } from './model'
import * as Model from './model'
import { EffectfulUpdater, useRefMap, useEffectfulUpdate } from '../../ui/hooks'
import { clampTo } from '../../utils'
import { Keybinding, Keybindings, useShortcuts } from '../../ui/shortcuts'


/**************** Code Actions **************/


function findFocused(refMap: Map<number, SheetLineRef>) {
    if (!document.activeElement) {
        return undefined
    }
    return [...refMap.entries()].find(([id, ref]) => ref.isFocused())
}

function findRelativeTo<Id, Line extends { id: Id }>(lines: Line[], id: Id, relativeIndex: number): Line | null {
    if (lines.length === 0) { return null }
    const index = lines.findIndex(line => line.id === id)
    if (index < 0) { return null }
    const newIndex = clampTo(0, lines.length, index + relativeIndex)
    return lines[newIndex]
}


type FocusTarget = 'line' | 'var' | 'inner'

function focusLineRef(ref: SheetLineRef, target: FocusTarget) {
    switch (target) {
        case 'line':
            ref.focus()
            return

        case 'var':
            ref.focusVar()
            return

        case 'inner':
            ref.focusInner()
            return
    }
}

type Actions<Inner> = ReturnType<typeof ACTIONS<Inner>>

function ACTIONS<Inner extends unknown>(
    update: EffectfulUpdater<SheetBlockState<Inner>>,
    container: React.MutableRefObject<HTMLElement>,
    refMap: Map<number, SheetLineRef>,
    innerBlock: Block<Inner>,
) {
    function effectlessUpdate(action: (state: SheetBlockState<Inner>) => SheetBlockState<Inner>) {
        update(state => ({ state: action(state) }))
    }

    function insertBeforeCode(state: SheetBlockState<Inner>, id: number, innerBlock: Block<Inner>, focusTarget: FocusTarget = 'line') {
        const newId = Model.nextFreeId(state);
        return {
            state: Model.insertLineBefore(state, id, {
                id: newId,
                name: '',
                visibility: Model.VISIBILITY_STATES[0],
                state: innerBlock.init,
            }),
            effect() { focusLineRef(refMap.get(newId), focusTarget) },
        }
    }

    function insertAfterCode(state: SheetBlockState<Inner>, id: number, innerBlock: Block<Inner>, focusTarget: FocusTarget = 'line') {
        const newId = Model.nextFreeId(state)
        return {
            state: Model.insertLineAfter(state, id, {
                id: newId,
                name: '',
                visibility: Model.VISIBILITY_STATES[0],
                state: innerBlock.init,
            }),
            effect() { focusLineRef(refMap.get(newId), focusTarget) },
        }
    }

    function scroll(amount: number) {
        return {
            effect() {
                const scrollableContainer = findScrollableAncestor(container.current)
                if (scrollableContainer) {
                    scrollableContainer.scrollBy({
                        top: amount * scrollableContainer.clientHeight,
                        behavior: 'smooth',
                    })
                }
            },
        }
    }

    function focusUp(state: SheetBlockState<Inner>) {
        return {
            effect() {
                const focused = findFocused(refMap);
                if (focused === undefined) {
                    refMap.get(state.lines[0].id)?.focus()
                }
                else {
                    const prevId = findRelativeTo(state.lines, focused[0], -1)?.id
                    refMap.get(prevId)?.focus()
                }
            },
        }
    }

    function focusDown(state: SheetBlockState<Inner>) {
        return {
            effect() {
                const focused = findFocused(refMap)
                if (focused === undefined) {
                    refMap.get(state.lines[state.lines.length - 1].id)?.focus()
                }
                else {
                    const nextId = findRelativeTo(state.lines, focused[0], 1)?.id
                    refMap.get(nextId)?.focus()
                }
            },
        }
    }


    return {
        scroll(amount: number) { update(() => scroll(amount)) },

        focusUp() { update(focusUp) },

        focusDown() { update(focusDown) },

        focusFirst() {
            update(state => ({
                effect() {
                    const firstId = state.lines[0].id
                    refMap.get(firstId)?.focus()
                }
            }))
        },

        focusLast() {
            update(state => ({
                effect() {
                    const lastId = state.lines.slice(-1)[0].id
                    refMap.get(lastId)?.focus()
                }
            }))
        },

        rename(id: number) {
            update(() => ({
                effect() {
                    refMap.get(id)?.focusVar()
                },
            }))
        },

        setName(id: number, name: string) {
            update(state => ({
                state: Model.updateLineWithId(state, id, line => ({ ...line, name })),
            }));
        },

        switchCollapse(id: number) {
            update(state => ({
                state: Model.updateLineWithId(state, id, line => ({
                    ...line,
                    visibility: Model.nextLineVisibility(line.visibility),
                })),
                effect() {
                    const line = refMap.get(id)
                    if (line && !line.containsFocus()) {
                        line.focus();
                    }
                },
            }))
        },

        updateInner(
            id: number,
            action: (state: Inner) => Inner,
            innerBlock: Block<Inner>,
            env: Environment
        ) {
            effectlessUpdate(state =>
                Model.updateLineBlock(state, id, action, innerBlock, env, effectlessUpdate)
            )
        },

        insertBeforeCode(id: number, innerBlock: Block<Inner>, focusTarget: FocusTarget = 'line') {
            update(state => insertBeforeCode(state, id, innerBlock, focusTarget))
        },

        insertAfterCode(id: number, innerBlock: Block<Inner>, focusTarget: FocusTarget = 'line') {
            update(state => insertAfterCode(state, id, innerBlock, focusTarget))
        },

        focusOrCreatePrev(id: number, innerBlock: Block<Inner>) {
            update(state => {
                const currentIndex = state.lines.findIndex(line => line.id === id)
                if (currentIndex < 0) { return {} }
                if (currentIndex === 0) {
                    return insertBeforeCode(state, id, innerBlock, 'inner')
                }

                const prevLine = state.lines[currentIndex - 1]
                return {
                    effect() {
                        refMap.get(prevLine.id)?.focusInner()
                    }
                }
            })
        },

        focusOrCreateNext(id: number, innerBlock: Block<Inner>) {
            update(state => {
                const currentIndex = state.lines.findIndex(line => line.id === id)
                if (currentIndex < 0) { return {} }
                if (currentIndex === state.lines.length - 1) {
                    return insertAfterCode(state, id, innerBlock, 'inner')
                }

                const nextLine = state.lines[currentIndex + 1]
                return {
                    effect() {
                        refMap.get(nextLine.id)?.focusInner()
                    }
                }
            })
        },

        deleteCode(id: number) {
            update(state => {
                if (state.lines.length <= 1) {
                    return {
                        state: Model.init(innerBlock.init),
                    }
                }

                const idIndex = state.lines.findIndex(line => line.id === id);
                const linesWithoutId = state.lines.filter(line => line.id !== id);
                const nextFocusIndex = Math.max(0, Math.min(linesWithoutId.length - 1, idIndex - 1));
                const nextFocusId = linesWithoutId[nextFocusIndex].id;

                return {
                    state: { ...state, lines: linesWithoutId },
                    effect() { refMap.get(nextFocusId)?.focus() },
                }
            })
        },
    }

}



/**************** UI *****************/


export interface SheetProps<InnerState> {
    state: SheetBlockState<InnerState>
    update: BlockUpdater<SheetBlockState<InnerState>>
    innerBlock: Block<InnerState>
    env: Environment
}

export const Sheet = React.forwardRef(
    function Sheet<InnerState>(
        { state, update, innerBlock, env }: SheetProps<InnerState>,
        ref: React.Ref<BlockRef>
    ) {
        const [setLineRef, refMap] = useRefMap<number, SheetLineRef>()
        const containerRef = React.useRef<HTMLDivElement>()
        const updateWithEffect = useEffectfulUpdate(update)
        React.useImperativeHandle(
            ref,
            () => ({
                focus() {
                    refMap
                        .get(state.lines[0].id)
                        .focus()
                }
            }),
            [state]
        )

        const actions = ACTIONS(updateWithEffect, containerRef, refMap, innerBlock)

        return (
            <div ref={containerRef} className="pb-[80vh]">
                {block.mapWithEnv(
                    state.lines,
                    (line, localEnv) => {
                        return {
                            out: (
                                <SheetLine
                                    lineRef={setLineRef(line.id)}
                                    key={line.id}
                                    line={line}
                                    actions={actions}
                                    block={innerBlock}
                                    env={localEnv}
                                    />
                            ),
                            env: Model.lineToEnv(line, innerBlock),
                        }
                    },
                    env
                )}
            </div>
        )
    }
)

export interface SheetLineProps<InnerState> {
    line: SheetBlockLine<InnerState>
    actions: Actions<InnerState>
    block: Block<InnerState>
    env: Environment
    lineRef: React.Ref<SheetLineRef>
}

export interface SheetLineRef {
    isFocused(): boolean
    containsFocus(): boolean
    focus(): void
    focusVar(): void
    focusInner(): void
}

export function SheetLine<Inner>({ block, line, env, actions, lineRef }: SheetLineProps<Inner>) {
    const containerRef = React.useRef<HTMLDivElement>()
    const varInputRef = React.useRef<HTMLElement>()
    const innerBlockRef = React.useRef<BlockRef>()
    const resultRef = React.useRef<HTMLElement>()

    React.useImperativeHandle(
        lineRef,
        () => ({
            isFocused() {
                return !!containerRef.current && document.activeElement === containerRef.current
            },
            containsFocus() {
                return !!containerRef.current && containerRef.current.contains(document.activeElement)
            },
            focus() {
                containerRef.current?.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth',
                })
                containerRef.current?.focus({ preventScroll: true })
            },
            focusVar() {
                varInputRef.current?.focus()
            },
            focusInner() {
                innerBlockRef.current?.focus()
            }
        }),
    )

    const bindingsProps = useShortcuts(
        sheetLineBindings(actions, line, block, containerRef, innerBlockRef, resultRef, varInputRef)
    )

    function subupdate(action: (inner: Inner) => Inner) {
        actions.updateInner(line.id, action, block, env)
    }

    const varInputBindings: Keybindings = assignmentLineBindings<Inner>(line, innerBlockRef, actions)

    const shouldNameBeHidden = block.getResult(line.state) === undefined || React.isValidElement(block.getResult(line.state))

    return (
        <div
            ref={containerRef}
            className={`
                flex flex-row items-baseline space-x-2
                focus-visible:outline-0
                group
            `}
            tabIndex={-1}
            {...bindingsProps}
        >
            <div className="w-32 flex flex-row justify-end">
                <AssignmentLine
                    key="name"
                    ref={varInputRef}
                    line={line}
                    actions={actions}
                    bindings={varInputBindings}
                    style={{ display: undefined }}
                    className={shouldNameBeHidden ? "hidden group-focus-within:inline-block group-hover:inline-block" : "inline-block"}
                    />
            </div>
            
            {/* Focus/Hover Indicator */}
            <div className="border border-gray-300 self-stretch opacity-0 group-focus:border-blue-500 group-focus-within:border-blue-300 group-focus-within:opacity-100 group-hover:opacity-100" />

            <div className="flex flex-col space-y-1 flex-1">
                {line.visibility === 'block' &&
                    <ErrorBoundary key="block" title="There was an error in the subblock">
                        {block.view({ ref: innerBlockRef, state: line.state, update: subupdate, env })}
                    </ErrorBoundary>
                }
                {line.visibility === 'result' &&
                    <ValueInspector key="result" ref={resultRef} value={Model.getLineResult(line, block)} expandLevel={0} />
                }
            </div>
        </div>
    )
}

function sheetLineBindings<Inner>(
    actions: Actions<Inner>,
    line: SheetBlockLine<Inner>,
    block: block.Block<Inner>,
    containerRef: React.MutableRefObject<HTMLDivElement>,
    innerBlockRef: React.MutableRefObject<block.BlockRef>,
    resultRef: React.MutableRefObject<HTMLElement>,
    varInputRef: React.MutableRefObject<HTMLElement>,
): Keybindings {
    function insertBelowByEnter(event?: React.KeyboardEvent) {
        if (event && !event.defaultPrevented) { return }
        actions.insertAfterCode(line.id, block, 'inner')
    }
    return [
        {
            description: "change lines",
            bindings: [
                [["C-Enter", "O"],                   "selfFocused",  "insert below",     () => actions.insertAfterCode(line.id, block, 'inner')],
                [["C-Shift-Enter", "Shift-O"],       "selfFocused",  "insert above",     () => actions.insertBeforeCode(line.id, block, 'inner')],
                [["C-Shift-R"],                      "none",         "rename",           () => actions.rename(line.id)],
                [["C-Backspace", "Backspace"],       "selfFocused",  "delete line",      () => actions.deleteCode(line.id)],
                [["Enter"],                          "!selfFocused", "insert below",     insertBelowByEnter],
            ]
        },
        {
            description: "line view",
            bindings: [
                [["C-M"],                            "none",         "cycle visibility", () => actions.switchCollapse(line.id)],
                [["Escape"],                         "!selfFocused", "focus out",        () => containerRef.current?.focus()],
                [
                    ["Enter"],
                    "selfFocused",
                    "focus inner",
                    () => {
                        if (line.visibility === 'block') {
                            innerBlockRef.current?.focus()
                        } else if (line.visibility === 'result') {
                            resultRef.current?.focus()
                        }
                    },
                ],
            ]
        },
        {
            description: "move between lines",
            bindings: [
                [["ArrowUp", "K"],                   "selfFocused",   "move up",         () => actions.focusUp()],
                [["ArrowDown", "J"],                 "selfFocused",   "move down",       () => actions.focusDown()],
                [["C-Enter"],                        "!selfFocused",  "jump next",       () => actions.focusOrCreateNext(line.id, block)],
                [["C-Shift-Enter"],                  "!selfFocused",  "jump prev",       () => actions.focusOrCreatePrev(line.id, block)],
                [["G"],                              "!inputFocused", "jump top",        () => actions.focusFirst()],
                [["Shift-G"],                        "!inputFocused", "jump bottom",     () => actions.focusLast()],
            ]
        },
        {
            description: "scroll sheet",
            bindings: [
                [["C-ArrowUp", "C-K"],               "none",         "scroll UP",        () => actions.scroll(-0.25)],
                [["C-ArrowDown", "C-J"],             "none",         "scroll DOWN",      () => actions.scroll(0.25)],
                [["C-Shift-ArrowUp", "C-Shift-K"],   "none",         "scroll up",        () => actions.scroll(-0.1)],
                [["C-Shift-ArrowDown", "C-Shift-J"], "none",         "scroll down",      () => actions.scroll(0.1)],
            ]
        },
    ]
}

function assignmentLineBindings<Inner>(
    line: SheetBlockLine<Inner>,
    innerBlockRef: React.MutableRefObject<block.BlockRef>,
    actions: Actions<Inner>,
): Keybindings {
    return [
        {
            description: "line name",
            bindings: [
                [
                    ["ArrowDown", "Enter"],
                    "none",
                    "jump next",
                    () => {
                        if (line.visibility === 'block') {
                            innerBlockRef.current?.focus()
                        }
                        else {
                            actions.focusDown()
                        }
                    },
                ],
            ]
        }
    ]
}


interface AssignmentLineProps<State> extends React.HTMLProps<HTMLElement> {
    line: SheetBlockLine<State>
    actions: Actions<State>
    bindings: Keybindings
}

export const AssignmentLine = React.forwardRef(
    function AssignmentLine<State>(props: AssignmentLineProps<State>, ref: React.Ref<HTMLElement>) {
        const { line, actions, bindings, className, ...inputProps } = props
        const bindingsProps = useShortcuts(bindings)

        function onUpdateName(name: string) {
            actions.setName(line.id, name)
        }

        return (
            <TextInput
                ref={ref}
                className={`
                    text-slate-500 font-light text-xs truncate
                    hover:bg-gray-200 hover:text-slate-700
                    focus-within:bg-gray-200 focus-within:text-slate-700
                    outline-none
                    rounded
                    ${className}
                `}
                value={line.name}
                onUpdate={onUpdateName}
                placeholder={Model.lineDefaultName(line)}
                {...inputProps}
                {...bindingsProps}
            />
        )
    }
)
