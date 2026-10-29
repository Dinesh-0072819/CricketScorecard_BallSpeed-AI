import cv2

class Camera:

    def __init__(self):
        self.cap = None
        self.running = False

    def start(self):
        if not self.running:
            self.cap = cv2.VideoCapture(0)
            self.running = True

    def stop(self):
        if self.cap:
            self.cap.release()
            self.cap = None
        self.running = False

    def get_frame(self):

        if not self.running:
            return None

        success, frame = self.cap.read()

        if not success:
            return None

        return frame