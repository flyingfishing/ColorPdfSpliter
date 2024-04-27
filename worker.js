// Worker 线程
onmessage = function (e) {
    self[e.data.f](e.data.args);
}

// Setup your project to serve `py-worker.js`. You should also serve
// `pyodide.js`, and all its associated `.asm.js`, `.json`,
// and `.wasm` files as well:
importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js");

println = (text) => postMessage({ f: 'println', args: text });
print = (text) => postMessage({ f: 'print', args: text });
printError = (text) => postMessage({ f: 'printError', args: text });

async function main() {
    pyodide = await loadPyodide({
        // indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/",
        // fullStdLib: false,
        // stdout: text => {
        //     printMessage(text);
        // },
        stderr: text => {
            postMessage(text);
        }
    });

    println('[1/3] 正在加载micropip...')
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    print('✅')
    println('[2/3] 正在加载PyMuPDF...')
    // Build a wheel for pyodide: https://pymupdf.readthedocs.io/en/latest/pyodide.html
    // await pyodide.loadPackage('https://ghostscript.com/~julian/pyodide/PyMuPDF-1.23.5-cp311-none-emscripten_3_1_32_wasm32.whl');
    await pyodide.loadPackage('PyMuPDF-1.23.5-cp311-none-emscripten_3_1_32_wasm32.whl');
    print('✅')
    println('[3/3] 正在加载numpy...')
    await micropip.install('numpy')
    pyodide.runPython(`
            import sys
            print(sys.version)

            import fitz
            print(fitz.version)
            `)
    print('✅')
    println('库引用完成');

    //读取当前目录下的script.py文件
    pyodide.runPython(await (await fetch("./ColorPdfSpliterWeb.py")).text());
    println('脚本加载完成');

    // 显示上传按钮
    postMessage({ f: "enableComponents" })
    println('🆗准备就绪');

    return pyodide
}

var pyodide = main();

async function generateLink(link, filename) {
    // 检查文件是否存在
    let fileExist = await pyodide.runPython(`os.path.exists("${link}")`)
    if (!fileExist) {
        println(`没有 ${filename}`)
        return
    }

    var array
    try {
        array = await pyodide.runPython(`
                    with open('${link}', 'rb') as fh:
                        arr = fh.read()
                    import base64
                    base64.b64encode(arr).decode('utf-8')
                `);
    } catch (e) {
        printError(e.message)
        return
    }

    // Decode Base64 content to binary
    const binaryContent = atob(array);

    // Create a Uint8Array from the binary content
    const arrayBuffer = new Uint8Array(binaryContent.length);
    for (let i = 0; i < binaryContent.length; i++) {
        arrayBuffer[i] = binaryContent.charCodeAt(i);
    }

    var blob = new Blob([arrayBuffer], { type: 'application/pdf' });

    // 输出
    postMessage({ f: "generateFileLink", args: [filename, blob] })
}


function processFile(file) {
    // Referred to https://github.com/pyodide/pyodide/issues/679
    var reader = new FileReader();
    reader.readAsBinaryString(file);
    reader.onload = async function (evt) {
        println('正在读取文件')
        content = evt.target.result;
        var output = pyodide.runPython('from js import content\ncontent');
        var l = output.length;
        var array = new Uint8Array(l);
        for (var i = 0; i < l; i++) {
            array[i] = output.charCodeAt(i);
        }

        pyodide.FS.writeFile(file.name, array);
        // println('正在处理文件,请稍等...具体进度可以查看F12的控制台(console)')
        // pyodide.globals.set('logProgress', (current,total) => println(`已处理${current}/${total}`))
        println('正在处理文件,请稍等...')
        pyodide.globals.set('logProgress', (current, total) => postMessage({ f: 'setProgress', args: [current, total] }));

        var state = undefined
        try {
            await pyodide.runPythonAsync(`
                        splitPDF('${file.name}')
                        # showAllFiles('/')
                    `);
        } catch (e) {
            state = e.message
            printError(e.message)
        }

        // 如果state不为undefined，说明处理失败
        if (state !== undefined) {
            println('❌文件处理失败')
            return;
        }

        println('✅文件处理完成，正在保存')

        // 去除'.pdf'后缀
        let filename = file.name.slice(0, -4)
        await generateLink(`/home/pyodide/${filename}_黑白.pdf`, `${filename}_黑白.pdf`)
        await generateLink(`/home/pyodide/${filename}_彩色.pdf`, `${filename}_彩色.pdf`)
    }
}