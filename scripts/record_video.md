# Запасное видео маршрута для слабых устройств

На `marshrut.html` вместо 3D показывается `media/marshrut.mp4` (зацикленный круг лошади), если:
нет WebGL, включена экономия трафика или даже на минимальном разрешении меньше 18 кадров/с.
Проверить вручную: `marshrut.html?video`.

Перезаписать видео (после смены маршрута или стиля):

1. Локальный сервер сайта: `python3 -m http.server 8765 --bind 127.0.0.1`
2. Приёмник кадров: `python3 scripts/record_receiver.py /tmp/frames` (порт 8766)
3. Открыть `http://127.0.0.1:8765/marshrut.html?record` и держать вкладку на экране.
   Первый круг просчитывается без записи, второй снимается по кадрам (1280×720, 30 кадров/с).
   Когда в папке появится файл `DONE`, запись закончена.
4. Склеить:

       ffmpeg -framerate 30 -i /tmp/frames/%05d.jpg -vf scale=960:-2 -c:v libx264 -preset slow -crf 33 \
         -pix_fmt yuv420p -g 60 -movflags +faststart -an media/marshrut.mp4
       ffmpeg -i /tmp/frames/00000.jpg -vf scale=960:-2 -q:v 5 media/marshrut-poster.jpg

Конец круга совпадает с началом, поэтому видео зацикливается без шва.
