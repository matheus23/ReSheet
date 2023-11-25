import { Block, BlockUpdater, Environment, mapWithEnv } from '../../block'
import * as Multiple from '../../block/multiple'
import { HistoryWrapper, initHistory, historyFromJSON, historyToJSON } from './history'
import { PageId, PageState } from './pages'
import * as Pages from './pages'

export interface ViewState {
    sidebarOpen: boolean
    openPage: PageId[]
}

export type ViewStateJSON = ViewState


export type DocumentState<State> = HistoryWrapper<DocumentInner<State>>

export interface DocumentInner<State> {
    readonly viewState: ViewState
    readonly template: PageState<State>
    readonly pages: Array<PageState<State>>
}

export function init<State>(initState: State): DocumentState<State> {
    return (
        initHistory({
            viewState: {
                sidebarOpen: true,
                openPage: [],
            },
            template: Pages.init(-1, initState),
            pages: [],
        })
    )
}


export function getResult<State>(state: DocumentState<State>, env: Environment) {
    return Multiple.getResultEnv(state.inner.pages)
}

export function onEnvironmentChange<State>(state: DocumentState<State>, update: BlockUpdater<DocumentState<State>>, env: Environment, innerBlock: Block<State>) {
    function updatePageState(path: PageId[], action: (state: State) => State) {
        update(state => ({
            ...state,
            inner: {
                ...state.inner,
                pages: Pages.updatePageAt(
                    path,
                    state.inner.pages,
                    page => ({ ...page, state: action(page.state) }),
                    env,
                    innerBlock,
                ),
            }
        }))
    }
    return {
        ...state,
        inner: {
            ...state.inner,
            pages: Pages.updatePages(
                [],
                state.inner.pages,
                (path, page, localEnv) => {
                    function localUpdate(action: (state: State) => State) {
                        updatePageState(path, action)
                    }
                    return {
                        ...page,
                        state: innerBlock.onEnvironmentChange(page.state, localUpdate, localEnv),
                    }
                },
                innerBlock,
                env,
            ),
        },
    }
}


export function innerFromJSON<State>(
    json: any,
    update: BlockUpdater<DocumentInner<State>>,
    env: Environment,
    innerBlock: Block<State>,
): DocumentInner<State> {
    const {
        pages = [],
        template,
        viewState = {},
    } = json
    const {
        sidebarOpen = true,
        openPage = [],
    } = viewState

    function updatePages(action: (state: PageState<State>[]) => PageState<State>[]) {
        update(state => ({
            ...state,
            pages: action(state.pages)
        }))
    }

    const loadedTemplate = (
        template ?
            Pages.pageFromJSON(template, () => {}, env, innerBlock, [])
        :
            Pages.init(-1, innerBlock.init)
    )
    const loadedPages = Pages.fromJSON(pages, updatePages, env, innerBlock, [])
    return {
        pages: loadedPages,
        template: loadedTemplate,
        viewState: {
            sidebarOpen,
            openPage,
        },
    }
}

export function fromJSON<State>(
    json: any,
    update: BlockUpdater<DocumentState<State>>,
    env: Environment,
    innerBlock: Block<State>
): DocumentState<State> {
    function updateInner(action: (state: DocumentInner<State>) => DocumentInner<State>) {
        update(state => ({
            ...state,
            inner: action(state.inner),
        }))
    }

    return historyFromJSON(json, env, (stateJSON, env) => {
        return innerFromJSON(stateJSON, updateInner, env, innerBlock)
    })
}

export function toJSON<State>(state: DocumentState<State>, innerBlock: Block<State>) {
    return historyToJSON(state, innerState => {
        const { viewState } = innerState
        const template = Pages.pageToJSON(innerState.template, innerBlock)
        const pages = Pages.toJSON(innerState.pages, innerBlock)
        return { pages, viewState, template }
    })
}






export function getOpenPage<State>(state: DocumentInner<State>): PageState<State> | null {
    return Pages.getPageAt(state.viewState.openPage, state.pages)
}

export function getOpenPageEnv<State>(
    state: DocumentInner<State>,
    env: Environment,
) {
    const page = getOpenPage(state)
    if (page === null) { return env }
    
    const siblings =
        state.viewState.openPage.length <= 1 ?
            state.pages
        :
            Pages.getPageAt(state.viewState.openPage.slice(0, -1), state.pages).children

    return Pages.getPageEnv(page, siblings, env)
}


export function deletePageAt<State>(
    path: PageId[],
    state: DocumentInner<State>,
    innerBlock: Block<State>,
    env: Environment,
): DocumentInner<State> {
    if (path.length === 0) { return state }
    const parentPath = path.slice(0, -1)
    const childIdToRemove = path.slice(-1)[0]

    if (parentPath.length === 0) {
        return {
            ...state,
            pages: Pages.updatePages(
                [],
                state.pages.filter(page => page.id !== childIdToRemove),
                (_currentPath, page) => page,
                innerBlock,
                env,
            ),
        }
    }
    return {
        ...state,
        pages: (
            Pages.updatePageAt(
                parentPath,
                state.pages,
                page => ({
                    ...page,
                    children: page.children.filter(child => child.id !== childIdToRemove),
                }),
                env,
                innerBlock,
            )
        ),
    }
}


export function addPageAt<State>(
    path: PageId[],
    state: DocumentInner<State>,
    innerBlock: Block<State>,
    env: Environment,
): DocumentInner<State> {
    function addSibling(siblings: PageState<State>[]): [ PageId, PageState<State>[] ] {
        const newId = Multiple.nextFreeId(siblings)
        const newPage = {
            ...state.template,
            id: newId,
            name: "Untitled_" + newId,
        }
        return [
            newId,
            [ ...siblings, newPage ],
        ]
    }

    if (path.length === 0) {
        const [id, pages] = addSibling(state.pages)
        return {
            ...state,
            viewState: {
                ...state.viewState,
                openPage: [id],
            },
            pages,
        }
    }

    let newId = null

    const newPages = (
        Pages.updatePageAt(
            path,
            state.pages,
            page => {
                const [id, children] = addSibling(page.children)
                newId = id
                return { ...page, children }
            },
            env,
            innerBlock,
        )
    )

    if (newId === null) { return state }

    return {
        ...state,
        viewState: {
            ...state.viewState,
            openPage: [...path, newId],
        },
        pages: newPages,
    }
}

export function updateOpenPage<State>(
    state: DocumentInner<State>,
    action: (state: State) => State,
    innerBlock: Block<State>,
    env: Environment,
): DocumentInner<State> {
    return {
        ...state,
        pages: (
            Pages.updatePageAt(
                state.viewState.openPage,
                state.pages,
                page => ({ ...page, state: action(page.state) }),
                env,
                innerBlock,
            )
        ),
    }
}





