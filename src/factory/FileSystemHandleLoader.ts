import type { ModelSettings } from "@/cubism-common";
import type { ExtendedFileList, Live2DFactoryContext } from "@/factory";
import { Live2DFactory } from "@/factory";
import type { Middleware } from "@/utils/middleware";

/**
 * Experimental loader to load resources from a
 * [FileSystemHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle).
 *
 * Though named as a "Loader", this class has nothing to do with Live2DLoader,
 * it only contains a middleware for the Live2DFactory.
 */
export class FileSystemHandleLoader {
    // will be set by Live2DFactory
    private static live2dFactory: typeof Live2DFactory;

    static FILE_SYSTEM_PROTOCOL = "filesystem://";
    private static uid = 0;

    /**
     * Middleware for Live2DFactory.
     */
    static factory: Middleware<Live2DFactoryContext> = async (
        context,
        next,
    ) => {
        const source = context.source;
        if (
            typeof FileSystemDirectoryHandle !== "undefined" &&
            source instanceof FileSystemDirectoryHandle
        ) {
            const settings = await FileSystemHandleLoader.createSettings(
                source,
            );

            // a fake URL, the only requirement is it should be unique,
            // as FileLoader will use it as the ID of all uploaded files
            settings._objectURL =
                `${FileSystemHandleLoader.FILE_SYSTEM_PROTOCOL}${FileSystemHandleLoader
                    .uid++}/${settings.url}`;

            const files = await arrayFromAsync(FileSystemHandleLoader.getFiles(
                source,
                settings,
            ));

            (files as ExtendedFileList).settings = settings;

            // pass files to the FileLoader
            context.source = files;
        }
        return next();
    };

    /**
     * Creates a ModelSettings by finding and parsing the settings file in the given directory.
     * @return Promise that resolves with the created ModelSettings.
     */
    private static async createSettings(
        source: FileSystemDirectoryHandle,
    ): Promise<ModelSettings> {
        const filePaths = await arrayFromAsync(source.keys());

        const settingsFilePath = filePaths.find((path) =>
            path.endsWith(".model.json") || path.endsWith(".model3.json")
        );

        if (!settingsFilePath) {
            throw new Error("Settings file not found");
        }

        const settingsFileHandle = await source.getFileHandle(settingsFilePath);
        const settingsFile = await settingsFileHandle.getFile();
        const settingsText = await settingsFile.text();

        if (!settingsText) {
            throw new Error(`Empty settings file: ${settingsFilePath}`);
        }

        const settingsJSON = JSON.parse(settingsText);

        settingsJSON.url = settingsFilePath;

        const runtime = FileSystemHandleLoader.live2dFactory.findRuntime(
            settingsJSON,
        );

        if (!runtime) {
            throw new Error("Unknown settings JSON");
        }

        return runtime.createModelSettings(settingsJSON);
    }

    /**
     * Recursively reads all files from a directory handle.
     * Each `File` will be attached with a `webkitRelativePath` property for `FileLoader`.
     * @return Promise that resolves with an array of `File`s.
     */
    private static async *getFiles(
        source: FileSystemDirectoryHandle,
        settings: ModelSettings,
        basePath = "",
    ): AsyncGenerator<File> {
        const definedFilePaths = settings.getDefinedFiles()
            .filter((path) => path.startsWith(basePath))
            .map((path) => path.slice(basePath.length));

        // iterate over the files
        const fileNames = definedFilePaths.filter((file) =>
            !file.includes("/")
        );
        for (const fileName of fileNames) {
            const file = await source.getFileHandle(fileName)
                .then((fileHandle) => fileHandle.getFile())
                .catch(() => null);
            if (file === null) continue;

            const relativePath = `${basePath}${fileName}`;
            // let's borrow this property
            Object.defineProperty(file, "webkitRelativePath", {
                value: relativePath,
            });
            yield file;
        }

        // iterate over the directories
        const directorieNames = new Set(
            definedFilePaths
                .filter((file) => file.includes("/"))
                .map((file) => file.slice(0, file.lastIndexOf("/"))),
        );
        for (const directoryName of directorieNames) {
            const directoryHandle = await source
                .getDirectoryHandle(directoryName)
                .catch(() => null);
            if (directoryHandle === null) continue;

            const relativePath = `${basePath}${directoryName}/`;
            yield* FileSystemHandleLoader.getFiles(
                directoryHandle,
                settings,
                relativePath,
            );
        }
    }
}

const arrayFromAsync: typeof Array.fromAsync =
    typeof Array.fromAsync === "function"
        ? Array.fromAsync
        : async function fromAsync<T>(asyncIterable: AsyncIterable<T>) {
            const array: T[] = [];
            for await (const item of asyncIterable) {
                array.push(item);
            }
            return array;
        };
